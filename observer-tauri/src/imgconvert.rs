//! M5 格式转换(第二片:图片,design.md §4 / method.md §8)。
//!
//! 解码复用 imgdec(RAW/PSD/HEIC 专用 crate)与 image crate(其余,含 GIF/APNG/
//! 动画 WebP 的帧迭代、SVG 经 resvg 栅格化),编码走 image crate;媒体字节全程
//! 不出 Rust(铁律 2 在图片转换上零例外——IPC 只传路径/格式字符串,返回写出路径
//! 列表,优于 3D 的 base64 输出侧例外)。落盘复用 convert::{unique_path,
//! write_atomic}(重名 " (n)" 绝不覆盖)。
//!
//! image_info 是只读文件头的轻量嗅探(宽高/格式级透明/动画帧数/ICO 条目数/位深),
//! 供前端在转换确认弹窗中判定警告;探针失败回退保守值,不阻塞转换(真实错误在
//! convert 时如实暴露)。
//!
//! 已知限制(登记于 task.md):AVIF 源/目标均不支持(解码需 dav1d C 库,编码需
//! ravif 重依赖);WebP 编码仅无损(image-webp 上游现状);EXIF/GPS/ICC 元数据
//! 不随转(产物为全新编码,方向已应用进像素);多页 TIFF 取首页(与预览一致)。

use std::fs::File;
use std::io::{BufRead, BufReader, Cursor, Read, Seek, SeekFrom};
use std::path::Path;

use image::codecs::bmp::BmpEncoder;
use image::codecs::gif::GifDecoder;
use image::codecs::jpeg::JpegEncoder;
use image::codecs::png::PngDecoder;
use image::codecs::tiff::TiffEncoder;
use image::codecs::webp::WebPDecoder;
use image::codecs::webp::WebPEncoder;
use image::metadata::Orientation;
use image::{AnimationDecoder, DynamicImage, ExtendedColorType, Frame, ImageDecoder, ImageEncoder, ImageFormat, ImageReader};

use crate::convert::{unique_path, write_atomic};
use crate::imgdec::{decode_heic, decode_psd, decode_raw, image_format_for_ext, is_raw_ext};

/// 动画源拆帧输出上限(多图路径逐帧流式,超出直接报错,防内存/磁盘失控)。
const MAX_OUTPUT_IMAGES: u32 = 1000;
/// JPEG 固定输出质量(参数选择 UI 是 task.md 登记的后续项)。
const JPEG_QUALITY: u8 = 90;
/// SVG 渲染像素上限(无缩放原则下,只防病态固有尺寸撑爆内存)。
const MAX_SVG_PIXELS: f64 = 100_000_000.0;

// ---- Tauri 命令(薄封装) ----

/// image_info 返回:头部嗅探得到的转换判定元数据(不解码像素)。
/// width/height = 0 表示未解析(svg/psd/heic/raw 等);has_alpha 是格式级判断
/// (非像素级),前端措辞用"可能";探针失败整体回退保守值而非 Err。
#[derive(Default, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageInfo {
    pub width: u32,
    pub height: u32,
    pub has_alpha: bool,
    pub animated: bool,
    pub frame_count: u32,
    pub ico_count: u32,
    pub bit_depth: u8,
}

/// 轻量头部嗅探(读文件头 + seek 跳块,不解码像素)。
#[tauri::command]
pub fn image_info(path: String) -> Result<ImageInfo, String> {
    let p = Path::new(&path);
    let ext = ext_of(p);
    let mut r = BufReader::new(File::open(p).map_err(|e| format!("无法读取文件: {e}"))?);
    Ok(sniff_info(&mut r, &ext))
}

/// 图片转换:Rust 内 解码(应用 EXIF 方向)→ 编码 → 命名去重落盘,返回全部写出路径。
/// 多图输出:动画源转静态格式按帧编号 `_001` 起;多条目 ICO 按尺寸 `_256`。
/// async 命令(同步函数跑独立线程):RAW/PSD 解码可达数秒,不阻塞 WebView。
#[tauri::command(async)]
pub fn convert_image(path: String, format: String, out_dir: String) -> Result<Vec<String>, String> {
    let p = Path::new(&path);
    let ext = ext_of(p);
    let target = TargetFormat::from_ext(&format)?;
    let dir = Path::new(&out_dir);
    if !dir.is_dir() {
        return Err(format!("输出目录不存在: {out_dir}"));
    }
    let stem = p
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("image")
        .to_string();

    if ext == "avif" {
        // 前端已按 ext 出说明文案,这里兜底直调 invoke 的场景
        return Err("AVIF 源暂不支持转换(缺纯 Rust 解码器,待后续接入)".to_string());
    }
    if is_raw_ext(&ext) {
        // RAW 需要文件路径(demosaic/显影),与预览同一入口
        let img = decode_raw(p)?;
        return write_single(dir, &stem, &img, target);
    }
    let bytes = std::fs::read(p).map_err(|e| format!("无法读取文件: {e}"))?;
    match ext.as_str() {
        "psd" | "psb" => write_single(dir, &stem, &decode_psd(&bytes)?, target),
        "heic" | "heif" => write_single(dir, &stem, &decode_heic(&bytes)?, target),
        "svg" | "svgz" => write_single(dir, &stem, &decode_svg(&bytes, &ext)?, target),
        "ico" => convert_ico(&bytes, dir, &stem, target),
        "gif" | "png" | "apng" | "webp" => convert_anim_capable(&bytes, &ext, dir, &stem, target),
        _ => write_single(dir, &stem, &decode_single(&bytes, &ext)?, target),
    }
}

// ---- 目标格式 ----

/// 转换目标格式(7 种)。SVG 不做目标——位图→矢量不在范围;AVIF 编码未启用。
#[derive(Clone, Copy, PartialEq, Eq)]
enum TargetFormat {
    Png,
    Jpeg,
    WebP,
    Tiff,
    Bmp,
    Ico,
    Gif,
}

impl TargetFormat {
    fn from_ext(s: &str) -> Result<Self, String> {
        Ok(match s {
            "png" => Self::Png,
            "jpg" | "jpeg" => Self::Jpeg,
            "webp" => Self::WebP,
            "tiff" | "tif" => Self::Tiff,
            "bmp" => Self::Bmp,
            "ico" => Self::Ico,
            "gif" => Self::Gif,
            other => return Err(format!("暂不支持的目标格式: {other}")),
        })
    }
    /// 写文件用的规范扩展名(输出统一 jpg/tiff)。
    fn file_ext(self) -> &'static str {
        match self {
            Self::Png => "png",
            Self::Jpeg => "jpg",
            Self::WebP => "webp",
            Self::Tiff => "tiff",
            Self::Bmp => "bmp",
            Self::Ico => "ico",
            Self::Gif => "gif",
        }
    }
    // 透明/位深的目标能力判定(仅 JPEG 无透明、8bit-only 集)在前端
    // imageConvert.ts 的警告矩阵中实现——判定只发生一次,不在两侧重复。
}

// ---- 解码 ----

/// 单帧源解码 → DynamicImage(image-crate 格式应用 EXIF 方向,否则转出的图会与
/// 预览所见旋转不一致;psd/heic/raw/svg 在上层分发,无方向概念)。
fn decode_single(bytes: &[u8], ext: &str) -> Result<DynamicImage, String> {
    let fmt =
        image_format_for_ext(ext).ok_or_else(|| format!("暂不支持转换的图片格式: {ext}"))?;
    let mut dec = ImageReader::with_format(Cursor::new(bytes), fmt)
        .into_decoder()
        .map_err(|e| format!("解码失败: {e}"))?;
    let orientation = dec.orientation().unwrap_or(Orientation::NoTransforms);
    let mut img = DynamicImage::from_decoder(dec).map_err(|e| format!("解码失败: {e}"))?;
    img.apply_orientation(orientation);
    Ok(img)
}

/// 动画源逐帧(GIF/APNG/动画 WebP):AnimationDecoder::into_frames(),
/// 帧为已合成整画布,延时随帧携带(供 GIF 重编码透传)。
fn each_frame<R, F>(src: R, ext: &str, f: F) -> Result<(), String>
where
    R: BufRead + Seek,
    F: FnMut(Frame) -> Result<(), String>,
{
    match ext {
        "gif" => drive(GifDecoder::new(src).map_err(|e| format!("GIF 解析失败: {e}"))?, f),
        // ApngDecoder 对非动画 PNG 帧迭代为空,本函数只在已判定动画后调用
        "png" | "apng" => {
            let dec = PngDecoder::new(src)
                .map_err(|e| format!("PNG 解析失败: {e}"))?
                .apng()
                .map_err(|e| format!("APNG 解析失败: {e}"))?;
            drive(dec, f)
        }
        "webp" => drive(WebPDecoder::new(src).map_err(|e| format!("WebP 解析失败: {e}"))?, f),
        other => Err(format!("格式无动画语义,不应走帧路径: {other}")),
    }
}

fn drive<'a, D>(dec: D, mut f: impl FnMut(Frame) -> Result<(), String>) -> Result<(), String>
where
    D: AnimationDecoder<'a>,
{
    for fr in dec.into_frames() {
        let fr = fr.map_err(|e| format!("帧解码失败: {e}"))?;
        f(fr)?;
    }
    Ok(())
}

/// 全量收集帧(GIF 目标重编码用;超上限报错)。
fn decode_frames(bytes: &[u8], ext: &str) -> Result<Vec<Frame>, String> {
    let mut v = Vec::new();
    each_frame(Cursor::new(bytes), ext, |fr| {
        if v.len() >= MAX_OUTPUT_IMAGES as usize {
            return Err(format!("动画帧数超出转换上限 {MAX_OUTPUT_IMAGES}"));
        }
        v.push(fr);
        Ok(())
    })?;
    Ok(v)
}

/// ICO 条目解码:手解析 ICONDIR(宽高字节 0 → 256,对齐前端 IcoView);
/// PNG 条目直接解码;DIB 条目补 14 字节 BITMAPFILEHEADER 且高度减半(同前端 wrapBmp)。
fn decode_ico_entries(bytes: &[u8]) -> Result<Vec<DynamicImage>, String> {
    if bytes.len() < 6 || u16le(&bytes[2..4]) != 1 {
        return Err("ICO 文件头无效".to_string()); // type != 1(icon)
    }
    let count = u16le(&bytes[4..6]) as usize;
    let mut out = Vec::with_capacity(count.min(64));
    for i in 0..count {
        let base = 6 + i * 16;
        if base + 16 > bytes.len() {
            break; // 条目表越界:截断容错
        }
        let e = &bytes[base..base + 16];
        let size = u32le(&e[8..12]) as usize;
        let offset = u32le(&e[12..16]) as usize;
        if size == 0 || offset.saturating_add(size) > bytes.len() {
            continue; // 条目数据越界:跳过
        }
        let data = &bytes[offset..offset + size];
        let img = if data.starts_with(&[0x89, b'P', b'N', b'G']) {
            image::load_from_memory_with_format(data, ImageFormat::Png)
        } else {
            let bmp = wrap_ico_dib(data)?;
            image::load_from_memory_with_format(&bmp, ImageFormat::Bmp)
        }
        .map_err(|e| format!("ICO 条目解码失败: {e}"))?;
        out.push(img);
    }
    if out.is_empty() {
        Err("ICO 无可解码条目".to_string())
    } else {
        Ok(out)
    }
}

/// ICO 内嵌 DIB(BMP 缺 14 字节文件头、biHeight 为 XOR+AND 双倍)→ 完整 BMP 字节。
/// 尾部 AND 掩码字节解码器按减半后的高度自然忽略。
fn wrap_ico_dib(dib: &[u8]) -> Result<Vec<u8>, String> {
    if dib.len() < 40 {
        return Err("ICO 内嵌 DIB 头不完整".to_string());
    }
    let bi_size = u32le(&dib[0..4]) as usize;
    let bpp = u16le(&dib[14..16]) as usize;
    let palette = if bpp <= 8 { 4usize << bpp } else { 0 };
    let mut out = Vec::with_capacity(14 + dib.len());
    out.extend_from_slice(b"BM");
    out.extend_from_slice(&((14 + dib.len()) as u32).to_le_bytes()); // bfSize(含 AND,解码器忽略尾部)
    out.extend_from_slice(&0u16.to_le_bytes()); // bfReserved1/2
    out.extend_from_slice(&((14 + bi_size + palette) as u32).to_le_bytes()); // bfOffBits
    out.extend_from_slice(dib);
    // biHeight 减半(去掉 AND 掩码那一半)
    let h = u32le(&out[14 + 8..14 + 12]) / 2;
    out[14 + 8..14 + 12].copy_from_slice(&h.to_le_bytes());
    Ok(out)
}

/// SVG/SVGZ 栅格化:svgz 先 gunzip;无固有尺寸(缺/百分比 width/height)时注入
/// viewBox 尺寸(渲染紧贴内容),连 viewBox 都无则 1024×1024;透明背景。
fn decode_svg(bytes: &[u8], ext: &str) -> Result<DynamicImage, String> {
    let text = if ext == "svgz" {
        let mut s = String::new();
        flate2::read::GzDecoder::new(bytes)
            .read_to_string(&mut s)
            .map_err(|e| format!("SVGZ 解压失败: {e}"))?;
        s
    } else {
        String::from_utf8_lossy(bytes).into_owned()
    };
    let processed = ensure_svg_size(&text);
    // usvg::Options::default() 的 fontdb 是空库,系统字体须显式加载(否则 <text> 不渲染)
    let mut fontdb = resvg::usvg::fontdb::Database::new();
    fontdb.load_system_fonts();
    let mut opts = resvg::usvg::Options::default();
    opts.fontdb = std::sync::Arc::new(fontdb);
    let tree = resvg::usvg::Tree::from_str(&processed, &opts)
        .map_err(|e| format!("SVG 解析失败: {e}"))?;
    let size = tree.size();
    let w = (size.width().ceil() as u32).max(1);
    let h = (size.height().ceil() as u32).max(1);
    if w as f64 * h as f64 > MAX_SVG_PIXELS {
        return Err(format!("SVG 固有尺寸过大({w}×{h}),超出渲染上限"));
    }
    let mut pixmap = resvg::tiny_skia::Pixmap::new(w, h).ok_or("SVG 渲染尺寸无效")?;
    resvg::render(
        &tree,
        resvg::tiny_skia::Transform::identity(),
        &mut pixmap.as_mut(),
    );
    // tiny-skia Pixmap 为预乘 alpha,encode_png 输出正确直 alpha,再经 image 载回统一管线
    let png = pixmap
        .encode_png()
        .map_err(|e| format!("SVG 渲染失败: {e}"))?;
    image::load_from_memory(&png).map_err(|e| format!("SVG 渲染产物解码失败: {e}"))
}

/// 找到第一个 `<svg` 根标签的属性区(不含 `<svg` 与 `>`)。返回 (start, end) 偏移。
fn svg_root_span(text: &str) -> Option<(usize, usize)> {
    let start = text.find("<svg")?;
    let end = start + text[start..].find('>')?;
    Some((start, end))
}

/// 提取属性值(双引号/单引号/裸值);要求属性名前是空白(排除 data-width= 之类)。
fn attr_value<'a>(attrs: &'a str, name: &str) -> Option<&'a str> {
    let needle = format!("{name}=");
    let bytes = attrs.as_bytes();
    let mut from = 0;
    while let Some(p) = attrs[from..].find(&needle) {
        let at = from + p;
        if at == 0 || bytes[at - 1].is_ascii_whitespace() {
            let rest = &attrs[at + needle.len()..];
            return if let Some(stripped) = rest.strip_prefix('"') {
                stripped.find('"').map(|e| &stripped[..e])
            } else if let Some(stripped) = rest.strip_prefix('\'') {
                stripped.find('\'').map(|e| &stripped[..e])
            } else {
                rest.find(|c: char| c.is_whitespace() || c == '/' || c == '>')
                    .map(|e| &rest[..e])
                    .or(Some(rest))
            };
        }
        from = at + needle.len();
    }
    None
}

/// 属性数值解析:"8"/"8px" → 8.0;"100%"/非法 → None(视为无固有尺寸)。
fn parse_len(v: &str) -> Option<f32> {
    let v = v.trim();
    if v.ends_with('%') {
        return None;
    }
    let num: String = v
        .chars()
        .take_while(|c| c.is_ascii_digit() || *c == '.' || *c == '-' || *c == '+')
        .collect();
    num.parse::<f32>().ok().filter(|n| n.is_finite() && *n > 0.0)
}

/// 无固有尺寸的 SVG 注入显式 width/height(重写根标签,剔除旧 width/height token):
/// 有 viewBox → viewBox 尺寸;否则 1024×1024。有固有尺寸则原样返回。
fn ensure_svg_size(text: &str) -> String {
    let Some((start, end)) = svg_root_span(text) else {
        return text.to_string();
    };
    let attrs = &text[start + 4..end];
    let w_ok = attr_value(attrs, "width").and_then(parse_len).is_some();
    let h_ok = attr_value(attrs, "height").and_then(parse_len).is_some();
    if w_ok && h_ok {
        return text.to_string();
    }
    let (mut w, mut h) = (1024.0f32, 1024.0f32);
    if let Some(vb) = attr_value(attrs, "viewBox") {
        let parts: Vec<&str> = vb.split_ascii_whitespace().collect();
        if parts.len() == 4 {
            if let (Ok(vw), Ok(vh)) = (parts[2].parse::<f32>(), parts[3].parse::<f32>()) {
                if vw > 0.0 && vh > 0.0 {
                    w = vw;
                    h = vh;
                }
            }
        }
    }
    // token 化剔除旧 width/height;自闭合根标签的 '/' 挂在末 token 上,单独保回
    let mut tokens: Vec<String> = attrs.split_ascii_whitespace().map(str::to_string).collect();
    let self_close = tokens.last().is_some_and(|t| t.ends_with('/'));
    if self_close {
        if let Some(last) = tokens.last_mut() {
            if last.ends_with('/') {
                last.pop();
            }
        }
    }
    tokens.retain(|t| !(t.starts_with("width=") || t.starts_with("height=")));
    let mut tag = String::from("<svg");
    for t in &tokens {
        tag.push(' ');
        tag.push_str(t);
    }
    tag.push_str(&format!(" width=\"{w}\" height=\"{h}\""));
    tag.push_str(if self_close { "/>" } else { ">" });
    let mut out = String::with_capacity(text.len() + 48);
    out.push_str(&text[..start]);
    out.push_str(&tag);
    out.push_str(&text[end + 1..]);
    out
}

// ---- 编码 ----

/// 编码单帧图。Png/Tiff 保留原生位深(16 位不降;f32 → 16 位);Jpeg 白底压平后
/// RGB8 + 固定质量;WebP 无损 RGBA8(image-webp 上游仅无损);Bmp RGBA8。
fn encode_single(img: &DynamicImage, target: TargetFormat) -> Result<Vec<u8>, String> {
    match target {
        TargetFormat::Png => {
            let norm = normalize_float(img);
            let mut cur = Cursor::new(Vec::new());
            norm.write_to(&mut cur, ImageFormat::Png)
                .map_err(|e| format!("PNG 编码失败: {e}"))?;
            Ok(cur.into_inner())
        }
        TargetFormat::Tiff => {
            let norm = normalize_float(img);
            let mut cur = Cursor::new(Vec::new());
            TiffEncoder::new(&mut cur)
                .write_image(
                    norm.as_bytes(),
                    norm.width(),
                    norm.height(),
                    ExtendedColorType::from(norm.color()),
                )
                .map_err(|e| format!("TIFF 编码失败: {e}"))?;
            Ok(cur.into_inner())
        }
        TargetFormat::Jpeg => {
            let flat = flatten_alpha_white(img);
            let rgb = flat.to_rgb8();
            let mut out = Vec::new();
            JpegEncoder::new_with_quality(&mut out, JPEG_QUALITY)
                .write_image(
                    rgb.as_raw(),
                    rgb.width(),
                    rgb.height(),
                    ExtendedColorType::Rgb8,
                )
                .map_err(|e| format!("JPEG 编码失败: {e}"))?;
            Ok(out)
        }
        TargetFormat::WebP => encode_webp_lossless(img),
        TargetFormat::Bmp => {
            let rgba = img.to_rgba8();
            let mut out = Vec::new();
            BmpEncoder::new(&mut out)
                .write_image(
                    rgba.as_raw(),
                    rgba.width(),
                    rgba.height(),
                    ExtendedColorType::Rgba8,
                )
                .map_err(|e| format!("BMP 编码失败: {e}"))?;
            Ok(out)
        }
        // GIF/ICO 走专用容器编码,由上层拦截,不应到达
        TargetFormat::Ico | TargetFormat::Gif => Err("内部错误:ICO/GIF 需走容器编码".to_string()),
    }
}

/// WebP 无损编码(image 0.25 的 WebPEncoder 仅无损、无质量参数)。
fn encode_webp_lossless(img: &DynamicImage) -> Result<Vec<u8>, String> {
    let rgba = img.to_rgba8();
    let mut out = Vec::new();
    WebPEncoder::new_lossless(&mut out)
        .write_image(
            rgba.as_raw(),
            rgba.width(),
            rgba.height(),
            ExtendedColorType::Rgba8,
        )
        .map_err(|e| format!("WebP 编码失败: {e}"))?;
    Ok(out)
}

/// f32(EXR/HDR)归一化为 16 位(PNG/TIFF 目标保最大信息;8bit-only 目标由
/// 各编码分支自行 to_rgba8)。
fn normalize_float(img: &DynamicImage) -> DynamicImage {
    match img {
        DynamicImage::ImageRgb32F(_) => DynamicImage::ImageRgb16(img.to_rgb16()),
        DynamicImage::ImageRgba32F(_) => DynamicImage::ImageRgba16(img.to_rgba16()),
        _ => img.clone(),
    }
}

/// 透明 → 不透明目标(JPEG):白底合成 out = a*c + (1-a)*255,四舍五入。
fn flatten_alpha_white(img: &DynamicImage) -> DynamicImage {
    let mut rgba = img.to_rgba8();
    for px in rgba.pixels_mut() {
        let a = px.0[3] as u32;
        if a < 255 {
            let ch = |c: u8| ((c as u32 * a + (255 - a) * 255 + 127) / 255) as u8;
            *px = image::Rgba([ch(px.0[0]), ch(px.0[1]), ch(px.0[2]), 255]);
        }
    }
    DynamicImage::ImageRgba8(rgba)
}

/// GIF 输出(单帧=静态 GIF;动画=逐帧重编码,帧延时随 Frame 透传,循环语义固定无限)。
fn encode_gif(frames: Vec<Frame>) -> Result<Vec<u8>, String> {
    let mut cur = Cursor::new(Vec::new());
    {
        let mut enc = image::codecs::gif::GifEncoder::new(&mut cur);
        enc.set_repeat(image::codecs::gif::Repeat::Infinite)
            .map_err(|e| format!("GIF 编码失败: {e}"))?;
        for fr in frames {
            enc.encode_frame(fr)
                .map_err(|e| format!("GIF 编码失败: {e}"))?;
        }
    }
    Ok(cur.into_inner())
}

/// ICO 容器编码:ICONDIR(6B)+ N×ICONDIRENTRY(16B,宽高字节 min(尺寸,255),
/// 256→0)+ N 段内嵌 PNG(保留 alpha,现代程序通用)。单图源 N=1;ICO 多尺寸源
/// 合成单文件全尺寸保留。
fn encode_ico_container(imgs: &[DynamicImage]) -> Result<Vec<u8>, String> {
    if imgs.is_empty() || imgs.len() > u16::MAX as usize {
        return Err("ICO 条目数无效".to_string());
    }
    let mut pngs = Vec::with_capacity(imgs.len());
    let mut entries = Vec::with_capacity(imgs.len());
    let mut offset: u32 = 6 + 16 * imgs.len() as u32;
    for img in imgs {
        let rgba = img.to_rgba8();
        let (w, h) = rgba.dimensions();
        let mut cur = Cursor::new(Vec::new());
        DynamicImage::ImageRgba8(rgba)
            .write_to(&mut cur, ImageFormat::Png)
            .map_err(|e| format!("ICO 内嵌 PNG 编码失败: {e}"))?;
        let png = cur.into_inner();
        let mut e = [0u8; 16];
        e[0] = ico_size_byte(w);
        e[1] = ico_size_byte(h);
        e[4..6].copy_from_slice(&1u16.to_le_bytes()); // planes
        e[6..8].copy_from_slice(&32u16.to_le_bytes()); // bpp
        e[8..12].copy_from_slice(&(png.len() as u32).to_le_bytes());
        e[12..16].copy_from_slice(&offset.to_le_bytes());
        offset = offset.saturating_add(png.len() as u32);
        pngs.push(png);
        entries.push(e);
    }
    let mut out = Vec::new();
    out.extend_from_slice(&0u16.to_le_bytes()); // reserved
    out.extend_from_slice(&1u16.to_le_bytes()); // type=icon
    out.extend_from_slice(&(imgs.len() as u16).to_le_bytes());
    for e in entries {
        out.extend_from_slice(&e);
    }
    for p in pngs {
        out.extend_from_slice(&p);
    }
    Ok(out)
}

/// ICO 目录项宽高字节:0 表示 256。
fn ico_size_byte(v: u32) -> u8 {
    if v >= 256 {
        0
    } else {
        v as u8
    }
}

// ---- 落盘 ----

/// 单文件输出(单图源;GIF/ICO 经容器编码)。重名 " (n)" 绝不覆盖。
fn write_single(
    dir: &Path,
    stem: &str,
    img: &DynamicImage,
    target: TargetFormat,
) -> Result<Vec<String>, String> {
    let bytes = match target {
        TargetFormat::Gif => encode_gif(vec![Frame::new(img.to_rgba8())])?,
        TargetFormat::Ico => encode_ico_container(std::slice::from_ref(img))?,
        _ => encode_single(img, target)?,
    };
    let name = format!("{stem}.{}", target.file_ext());
    let fp = unique_path(dir, &name)?;
    write_atomic(&fp, &bytes)?;
    Ok(vec![fp.to_string_lossy().to_string()])
}

/// ICO 源分发:→ICO 多尺寸合成单文件;→GIF 取最大条目;→其余 单条目单图、
/// 多条目按尺寸命名多张(`stem_256.png`,重名去重照旧)。
fn convert_ico(
    bytes: &[u8],
    dir: &Path,
    stem: &str,
    target: TargetFormat,
) -> Result<Vec<String>, String> {
    let entries = decode_ico_entries(bytes)?;
    match target {
        TargetFormat::Ico => {
            let data = encode_ico_container(&entries)?;
            let name = format!("{stem}.ico");
            let fp = unique_path(dir, &name)?;
            write_atomic(&fp, &data)?;
            Ok(vec![fp.to_string_lossy().to_string()])
        }
        TargetFormat::Gif => {
            let best = max_entry(&entries);
            write_single(dir, stem, best, target)
        }
        _ => {
            let mut paths = Vec::with_capacity(entries.len());
            for img in &entries {
                let size = img.width().max(img.height());
                let data = encode_single(img, target)?;
                let name = format!("{stem}_{size}.{}", target.file_ext());
                let fp = unique_path(dir, &name)?;
                write_atomic(&fp, &data)?;
                paths.push(fp.to_string_lossy().to_string());
            }
            Ok(paths)
        }
    }
}

/// GIF/PNG(APNG)/WebP 源分发:→GIF 单文件(动画重编码/静态单帧);静态源单图;
/// 动画源转静态逐帧流式(解码→编码→落盘→释放,内存只占一帧)。
fn convert_anim_capable(
    bytes: &[u8],
    ext: &str,
    dir: &Path,
    stem: &str,
    target: TargetFormat,
) -> Result<Vec<String>, String> {
    let info = sniff_info(&mut Cursor::new(bytes), ext);
    if info.frame_count > MAX_OUTPUT_IMAGES {
        return Err(format!(
            "动画帧数过多({} 帧),超出转换上限 {MAX_OUTPUT_IMAGES}",
            info.frame_count
        ));
    }
    if target == TargetFormat::Gif {
        let frames = decode_frames(bytes, ext)?;
        let data = encode_gif(frames)?;
        let name = format!("{stem}.gif");
        let fp = unique_path(dir, &name)?;
        write_atomic(&fp, &data)?;
        return Ok(vec![fp.to_string_lossy().to_string()]);
    }
    if !(info.animated && info.frame_count > 1) {
        let img = decode_single(bytes, ext)?;
        return write_single(dir, stem, &img, target);
    }
    // 动画 → 静态:逐帧流式,`stem_001` 起编号(三位零填充)
    let mut paths: Vec<String> = Vec::new();
    let mut n: u32 = 0;
    let res = each_frame(Cursor::new(bytes), ext, |fr| {
        n += 1;
        if n > MAX_OUTPUT_IMAGES {
            return Err(format!("动画帧数超出上限 {MAX_OUTPUT_IMAGES}"));
        }
        let img = DynamicImage::ImageRgba8(fr.buffer().clone());
        let data = encode_single(&img, target)?;
        let name = format!("{stem}_{n:03}.{}", target.file_ext());
        let fp = unique_path(dir, &name)?;
        write_atomic(&fp, &data)?;
        paths.push(fp.to_string_lossy().to_string());
        Ok(())
    });
    res.map_err(|e| {
        if paths.is_empty() {
            e
        } else {
            format!("{e}(已写出前 {} 张)", paths.len())
        }
    })?;
    if paths.is_empty() {
        return Err("动画源无帧可转换".to_string());
    }
    Ok(paths)
}

/// 取面积最大的条目(ICO 源转单图目标用)。
fn max_entry<'a>(entries: &'a [DynamicImage]) -> &'a DynamicImage {
    entries
        .iter()
        .max_by_key(|i| i.width() as u64 * i.height() as u64)
        .expect("entries 非空由调用方保证")
}

fn ext_of(p: &Path) -> String {
    p.extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase()
}

// ---- image_info 头部解析(读头 + seek 跳块,不解码像素) ----

fn sniff_info<R: BufRead + Seek>(r: &mut R, ext: &str) -> ImageInfo {
    match ext {
        "png" | "apng" => png_info(r),
        "webp" => webp_info(r),
        "gif" => gif_info(r),
        "ico" => ico_info(r),
        // 矢量/专用 crate 格式:保守值(宽高不解析,格式级可透明)
        "svg" | "svgz" | "psd" | "psb" | "heic" | "heif" | "avif" => ImageInfo {
            has_alpha: true,
            ..Default::default()
        },
        _ if is_raw_ext(ext) => ImageInfo {
            has_alpha: false,
            bit_depth: 16,
            ..Default::default()
        },
        // jpg/bmp/tiff/tga/dds/qoi/hdr/exr:decoder 探针(纯头解析)
        _ => {
            if let Some(fmt) = image_format_for_ext(ext) {
                if let Ok(dec) = ImageReader::with_format(r, fmt).into_decoder() {
                    let (w, h) = dec.dimensions();
                    let ct = dec.color_type();
                    // bits_per_pixel 是全通道合计,除以通道数得每通道位深
                    let depth = (ct.bits_per_pixel() / ct.channel_count() as u16) as u8;
                    return ImageInfo {
                        width: w,
                        height: h,
                        has_alpha: ct.has_alpha(),
                        animated: false,
                        frame_count: 0,
                        ico_count: 0,
                        bit_depth: depth,
                    };
                }
            }
            ImageInfo::default()
        }
    }
}

/// PNG/APNG:IHDR(宽高/位深/颜色类型)+ tRNS(调色板透明)+ acTL(APNG 动画帧数)。
/// 扫到首个 IDAT 为止(acTL 必在其前);CRC 直接跳过(嗅探不解码)。
fn png_info<R: Read + Seek>(r: &mut R) -> ImageInfo {
    let mut info = ImageInfo::default();
    if r.seek(SeekFrom::Start(8)).is_err() {
        return info;
    }
    for _ in 0..4096 {
        let Some(hdr) = read_exact(r, 8) else { break };
        let len = u32be(&hdr[0..4]) as u64;
        if len > 1 << 30 {
            break; // 病态长度:截断容错
        }
        let ty = [hdr[4], hdr[5], hdr[6], hdr[7]];
        let read = match &ty {
            b"IHDR" => read_exact(r, len.min(13) as usize),
            b"acTL" => read_exact(r, len.min(8) as usize),
            _ => None,
        };
        match &ty {
            b"IHDR" => {
                if let Some(d) = &read {
                    if d.len() >= 10 {
                        info.width = u32be(&d[0..4]);
                        info.height = u32be(&d[4..8]);
                        info.bit_depth = d[8];
                        info.has_alpha = d[9] == 4 || d[9] == 6;
                    }
                }
            }
            b"tRNS" => info.has_alpha = true,
            b"acTL" => {
                if let Some(d) = &read {
                    if d.len() >= 4 {
                        info.frame_count = u32be(&d[0..4]);
                        info.animated = true;
                    }
                }
            }
            b"IDAT" => break,
            _ => {}
        }
        let consumed = read.map_or(0, |v| v.len() as u64);
        if r
            .seek(SeekFrom::Current((len - consumed + 4) as i64))
            .is_err()
        {
            break;
        }
    }
    info
}

/// WebP:遍历 RIFF chunk——VP8X(画布/alpha/animation 位)、ANMF(帧计数)、
/// ALPH(有损+alpha)、VP8L(无损头内 alpha 位)、VP8(有损关键帧宽高)。
fn webp_info<R: Read + Seek>(r: &mut R) -> ImageInfo {
    let mut info = ImageInfo::default();
    info.bit_depth = 8;
    let Some(hdr) = read_exact(r, 12) else {
        return info;
    };
    if &hdr[0..4] != b"RIFF" || &hdr[8..12] != b"WEBP" {
        return info;
    }
    let mut anim_flag = false;
    for _ in 0..65536 {
        let Some(ch) = read_exact(r, 8) else { break };
        let fourcc = [ch[0], ch[1], ch[2], ch[3]];
        let size = u32le(&ch[4..8]) as u64;
        let pad = size & 1; // chunk 按 2 字节对齐
        let read = match fourcc {
            [b'V', b'P', b'8', b'X'] => read_exact(r, size.min(10) as usize),
            [b'V', b'P', b'8', b'L'] => read_exact(r, size.min(5) as usize),
            [b'V', b'P', b'8', 0x20] => read_exact(r, size.min(10) as usize),
            _ => None,
        };
        match fourcc {
            [b'V', b'P', b'8', b'X'] => {
                if let Some(d) = &read {
                    if d.len() >= 10 {
                        anim_flag = d[0] & 0x02 != 0;
                        info.has_alpha = d[0] & 0x10 != 0;
                        info.width = u24le(&d[4..7]) + 1;
                        info.height = u24le(&d[7..10]) + 1;
                    }
                }
            }
            [b'A', b'N', b'M', b'F'] => info.frame_count += 1,
            [b'A', b'L', b'P', b'H'] => info.has_alpha = true,
            [b'V', b'P', b'8', b'L'] => {
                if let Some(d) = &read {
                    if d.len() >= 5 && d[0] == 0x2f {
                        let v = u32le(&d[1..5]);
                        info.width = (v & 0x3FFF) + 1;
                        info.height = ((v >> 14) & 0x3FFF) + 1;
                        info.has_alpha |= (v >> 28) & 1 == 1;
                    }
                }
            }
            [b'V', b'P', b'8', 0x20] => {
                if let Some(d) = &read {
                    if d.len() >= 10 {
                        info.width = (u16le(&d[6..8]) & 0x3FFF) as u32;
                        info.height = (u16le(&d[8..10]) & 0x3FFF) as u32;
                    }
                }
            }
            _ => {}
        }
        let consumed = read.map_or(0, |v| v.len() as u64);
        if r
            .seek(SeekFrom::Current((size - consumed + pad) as i64))
            .is_err()
        {
            break;
        }
    }
    info.animated = anim_flag && info.frame_count > 0;
    info
}

/// GIF:LSD 画布宽高;块结构遍历数 0x2C 图像分隔符(扩展/子块链按长度跳过,
/// 不解 LZW)。GIF 调色板可含透明索引,格式级保守记 has_alpha。
fn gif_info<R: Read + Seek>(r: &mut R) -> ImageInfo {
    let mut info = ImageInfo {
        has_alpha: true,
        bit_depth: 8,
        ..Default::default()
    };
    let Some(h) = read_exact(r, 13) else {
        return info;
    };
    info.width = u16le(&h[6..8]) as u32;
    info.height = u16le(&h[8..10]) as u32;
    let flags = h[10];
    if flags & 0x80 != 0 && r.seek(SeekFrom::Current(3 * (1 << ((flags & 7) + 1)) as i64)).is_err() {
        return info;
    }
    let mut frames = 0u32;
    for _ in 0..200_000 {
        // 防损坏文件死循环
        let Some(b) = read_exact(r, 1) else { break };
        match b[0] {
            0x3B => break, // trailer
            0x21 => {
                // 扩展块:label 1B + 子块链(len + 数据,0 终止)
                if read_exact(r, 1).is_none() {
                    break;
                }
                skip_subblocks(r);
            }
            0x2C => {
                frames += 1;
                // 图像描述符 9B(末字节 packed:bit7=局部色表);随后局部色表 + LZW 最小码长 1B
                let Some(d) = read_exact(r, 9) else { break };
                let mut skip: i64 = 1; // LZW 最小码长
                if d[8] & 0x80 != 0 {
                    skip += 3 * (1 << ((d[8] & 7) + 1)) as i64;
                }
                if r.seek(SeekFrom::Current(skip)).is_err() {
                    break;
                }
                skip_subblocks(r);
            }
            _ => break, // 损坏:截断容错
        }
    }
    info.frame_count = frames;
    info.animated = frames > 1;
    info
}

/// 跳过子块链(len 字节 + 数据,0 终止)。
fn skip_subblocks<R: Read + Seek>(r: &mut R) {
    for _ in 0..65536 {
        let Some(l) = read_exact(r, 1) else {
            return;
        };
        if l[0] == 0 || r.seek(SeekFrom::Current(l[0] as i64)).is_err() {
            return;
        }
    }
}

/// ICO:ICONDIR count + 条目宽高字节(0 → 256);宽高取最大条目(格式级可透明)。
fn ico_info<R: Read + Seek>(r: &mut R) -> ImageInfo {
    let mut info = ImageInfo {
        has_alpha: true,
        bit_depth: 8,
        ..Default::default()
    };
    let Some(h) = read_exact(r, 6) else {
        return info;
    };
    if u16le(&h[2..4]) != 1 {
        return info; // type != icon
    }
    let count = u16le(&h[4..6]);
    info.ico_count = count as u32;
    for _ in 0..count.min(256) {
        let Some(e) = read_exact(r, 16) else {
            break;
        };
        let w = if e[0] == 0 { 256 } else { e[0] as u32 };
        let h = if e[1] == 0 { 256 } else { e[1] as u32 };
        info.width = info.width.max(w);
        info.height = info.height.max(h);
    }
    info
}

// ---- 小工具 ----

fn read_exact<R: Read>(r: &mut R, n: usize) -> Option<Vec<u8>> {
    let mut v = vec![0u8; n];
    r.read_exact(&mut v).ok()?;
    Some(v)
}

fn u16le(b: &[u8]) -> u16 {
    u16::from_le_bytes([b[0], b[1]])
}

fn u24le(b: &[u8]) -> u32 {
    (b[0] as u32) | ((b[1] as u32) << 8) | ((b[2] as u32) << 16)
}

fn u32le(b: &[u8]) -> u32 {
    u32::from_le_bytes([b[0], b[1], b[2], b[3]])
}

fn u32be(b: &[u8]) -> u32 {
    u32::from_be_bytes([b[0], b[1], b[2], b[3]])
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::Delay;
    use std::io::Write;

    /// 每个用例独立的临时目录(temp + 用例名 + pid,防并发互踩;循 convert.rs)。
    fn tmp(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("observer_imgconv_{name}_{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn rgba8(w: u32, h: u32) -> DynamicImage {
        let mut buf = image::RgbaImage::new(w, h);
        for (x, y, p) in buf.enumerate_pixels_mut() {
            *p = image::Rgba([(x * 30 % 256) as u8, (y * 60 % 256) as u8, 128, 255]);
        }
        DynamicImage::ImageRgba8(buf)
    }

    fn encode_png_bytes(img: &DynamicImage) -> Vec<u8> {
        let mut cur = Cursor::new(Vec::new());
        img.write_to(&mut cur, ImageFormat::Png).unwrap();
        cur.into_inner()
    }

    /// 造 N 帧动画 GIF(不同延时),返回字节。
    fn gif_bytes(w: u32, h: u32, delays_ms: &[u32]) -> Vec<u8> {
        let frames: Vec<Frame> = delays_ms
            .iter()
            .map(|d| {
                let buf = rgba8(w, h).to_rgba8();
                Frame::from_parts(buf, 0, 0, Delay::from_numer_denom_ms(*d, 1))
            })
            .collect();
        let mut cur = Cursor::new(Vec::new());
        {
            let mut enc = image::codecs::gif::GifEncoder::new(&mut cur);
            enc.set_repeat(image::codecs::gif::Repeat::Infinite).unwrap();
            for fr in frames {
                enc.encode_frame(fr).unwrap();
            }
        }
        cur.into_inner()
    }

    /// 各目标编码 magic 校验(格式身份足够,内容 round-trip 由其余用例覆盖)。
    #[test]
    fn encode_single_magics() {
        let img = rgba8(8, 4);
        let png = encode_single(&img, TargetFormat::Png).unwrap();
        assert_eq!(&png[0..4], &[0x89, b'P', b'N', b'G']);
        let jpg = encode_single(&img, TargetFormat::Jpeg).unwrap();
        assert_eq!(&jpg[0..2], &[0xFF, 0xD8]);
        let webp = encode_single(&img, TargetFormat::WebP).unwrap();
        assert_eq!(&webp[0..4], b"RIFF");
        assert_eq!(&webp[8..12], b"WEBP");
        let tiff = encode_single(&img, TargetFormat::Tiff).unwrap();
        let ok = &tiff[0..4] == b"II\x2a\x00" || &tiff[0..4] == b"MM\x00\x2a";
        assert!(ok, "TIFF magic 不对: {:?}", &tiff[0..4]);
        let bmp = encode_single(&img, TargetFormat::Bmp).unwrap();
        assert_eq!(&bmp[0..2], b"BM");
    }

    /// ICO 容器 magic + 数量。
    #[test]
    fn encode_ico_magic() {
        let data = encode_ico_container(&[rgba8(16, 16), rgba8(32, 32)]).unwrap();
        assert_eq!(&data[0..4], &[0, 0, 1, 0]);
        assert_eq!(u16le(&data[4..6]), 2);
    }

    /// 透明压平:全透明→纯白;不透明保持;半透明按白底合成公式。
    #[test]
    fn flattens_alpha_on_white() {
        let mut buf = image::RgbaImage::new(3, 1);
        buf.put_pixel(0, 0, image::Rgba([10, 20, 30, 0]));
        buf.put_pixel(1, 0, image::Rgba([200, 100, 50, 255]));
        buf.put_pixel(2, 0, image::Rgba([0, 0, 0, 128]));
        let flat = flatten_alpha_white(&DynamicImage::ImageRgba8(buf)).to_rgba8();
        assert_eq!(flat.get_pixel(0, 0).0, [255, 255, 255, 255], "全透明应纯白");
        assert_eq!(flat.get_pixel(1, 0).0, [200, 100, 50, 255], "不透明应保持");
        let c = flat.get_pixel(2, 0).0;
        assert!((c[0] as i32 - 127).abs() <= 1, "半透明应约 127,实际 {}", c[0]);
    }

    /// GIF 动画往返:N 帧不同延时 → 逐帧解码回来帧数/尺寸/延时保持(APNG/动画
    /// WebP 共用 AnimationDecoder 路径,不重复造样本)。
    #[test]
    fn gif_roundtrips_frames_and_delays() {
        let bytes = gif_bytes(16, 8, &[10, 20, 30]);
        let frames = decode_frames(&bytes, "gif").unwrap();
        assert_eq!(frames.len(), 3, "帧数应保持");
        for (i, fr) in frames.iter().enumerate() {
            assert_eq!(fr.buffer().dimensions(), (16, 8), "帧画布尺寸应保持");
            assert_eq!(
                fr.delay().numer_denom_ms(),
                ((i as u32 + 1) * 10, 1),
                "帧延时应透传"
            );
        }
        // 重编码后仍是合法 GIF 且 sniff 出 3 帧
        let re = encode_gif(frames).unwrap();
        assert_eq!(&re[0..3], b"GIF");
        let info = sniff_info(&mut Cursor::new(&re), "gif");
        assert!(info.animated && info.frame_count == 3, "重编码应保持动画,实际 {info:?}");
    }

    /// ICO 多条目:PNG 条目 + 合成容器 → 解码回 2 条目且尺寸正确。
    #[test]
    fn ico_multi_entry_roundtrip() {
        let imgs = vec![rgba8(16, 16), rgba8(32, 32)];
        let data = encode_ico_container(&imgs).unwrap();
        let back = decode_ico_entries(&data).unwrap();
        assert_eq!(back.len(), 2, "条目数应保持");
        let dims: Vec<(u32, u32)> = back.iter().map(|i| (i.width(), i.height())).collect();
        assert!(dims.contains(&(16, 16)) && dims.contains(&(32, 32)), "尺寸应保持: {dims:?}");
        // image_info 计数
        let info = sniff_info(&mut Cursor::new(&data), "ico");
        assert_eq!(info.ico_count, 2);
        assert_eq!(info.width, 32, "宽高应取最大条目");
    }

    /// SVG:固有尺寸原样;仅 viewBox → viewBox 尺寸(注入后紧贴);连 viewBox 都无
    /// → 1024;svgz 先解压。
    #[test]
    fn decodes_svg_sizes() {
        let fixed = br##"<svg xmlns="http://www.w3.org/2000/svg" width="8" height="4"><rect width="8" height="4" fill="#f00"/></svg>"##;
        let img = decode_svg(fixed, "svg").unwrap();
        assert_eq!((img.width(), img.height()), (8, 4), "固有尺寸应原样");

        let vb = br##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100"><rect width="200" height="100" fill="#0f0"/></svg>"##;
        let img = decode_svg(vb, "svg").unwrap();
        assert_eq!((img.width(), img.height()), (200, 100), "viewBox 尺寸应注入");

        let none = br##"<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10" fill="#00f"/></svg>"##;
        let img = decode_svg(none, "svg").unwrap();
        assert_eq!((img.width(), img.height()), (1024, 1024), "无尺寸应兜底 1024");

        // svgz:同一 fixed 内容 gzip 后解压解码
        let mut z = Vec::new();
        let mut enc = flate2::write::GzEncoder::new(&mut z, flate2::Compression::default());
        enc.write_all(fixed).unwrap();
        enc.finish().unwrap();
        let img = decode_svg(&z, "svgz").unwrap();
        assert_eq!((img.width(), img.height()), (8, 4), "svgz 应先解压");
    }

    /// image_info:PNG(宽高/alpha/APNG acTL 帧数)与 WebP(静态无损)。
    #[test]
    fn sniffs_png_and_webp() {
        let png = encode_png_bytes(&rgba8(8, 4));
        let info = sniff_info(&mut Cursor::new(&png), "png");
        assert_eq!((info.width, info.height), (8, 4));
        assert!(info.has_alpha, "RGBA PNG 应记可透明");
        assert!(!info.animated);

        // 在 IHDR 后插入 acTL(num_frames=3):嗅探应识别为 APNG(CRC 填 0,嗅探不解码)
        let mut apng = Vec::new();
        apng.extend_from_slice(&png[0..33]); // 8 签名 + 25 IHDR chunk
        let mut actl = Vec::new();
        actl.extend_from_slice(&8u32.to_be_bytes());
        actl.extend_from_slice(b"acTL");
        actl.extend_from_slice(&3u32.to_be_bytes());
        actl.extend_from_slice(&0u32.to_be_bytes());
        apng.extend_from_slice(&actl);
        apng.extend_from_slice(&png[33..]);
        let info = sniff_info(&mut Cursor::new(&apng), "png");
        assert!(info.animated, "acTL 应识别为动画");
        assert_eq!(info.frame_count, 3, "acTL 帧数应读出");

        let webp = encode_webp_lossless(&rgba8(20, 10)).unwrap();
        let info = sniff_info(&mut Cursor::new(&webp), "webp");
        assert_eq!((info.width, info.height), (20, 10), "WebP 宽高应读出");
        assert!(!info.animated, "静态 WebP 不应记动画");
    }

    /// convert_image 端到端:png→jpg/png/ico;多尺寸 ICO→png 按尺寸命名;
    /// 动画 GIF→png 拆帧编号;重跑去重;非法输入报错。
    #[test]
    fn converts_end_to_end() {
        let dir = tmp("e2e");
        let src = dir.join("photo.png");
        std::fs::write(&src, encode_png_bytes(&rgba8(64, 32))).unwrap();
        let call = |fmt: &str| {
            convert_image(
                src.to_string_lossy().to_string(),
                fmt.to_string(),
                dir.to_string_lossy().to_string(),
            )
        };

        let paths = call("jpg").expect("png→jpg");
        assert!(paths[0].ends_with("photo.jpg"), "命名应规范 jpg: {}", paths[0]);
        assert_eq!(std::fs::read(&paths[0]).unwrap()[0..2], [0xFF, 0xD8], "JPEG magic");

        let paths = call("png").expect("png→png 同格式重编码");
        assert!(paths[0].ends_with("photo (1).png"), "重名应去重 (1): {}", paths[0]);

        let paths = call("ico").expect("png→ico");
        let ico = std::fs::read(&paths[0]).unwrap();
        assert_eq!(&ico[0..4], &[0, 0, 1, 0], "ICO magic");

        // 多尺寸 ICO → png:按尺寸命名多张
        let ico_src = dir.join("icon.ico");
        std::fs::write(
            &ico_src,
            encode_ico_container(&[rgba8(16, 16), rgba8(32, 32)]).unwrap(),
        )
        .unwrap();
        let paths = convert_image(
            ico_src.to_string_lossy().to_string(),
            "png".into(),
            dir.to_string_lossy().to_string(),
        )
        .expect("ico→png 多张");
        assert_eq!(paths.len(), 2, "两个尺寸应输出两张");
        assert!(paths.iter().any(|p| p.ends_with("icon_16.png")), "按尺寸命名: {paths:?}");
        assert!(paths.iter().any(|p| p.ends_with("icon_32.png")), "按尺寸命名: {paths:?}");

        // 动画 GIF → png:逐帧编号
        let gif_src = dir.join("anim.gif");
        std::fs::write(&gif_src, gif_bytes(16, 8, &[10, 20, 30])).unwrap();
        let paths = convert_image(
            gif_src.to_string_lossy().to_string(),
            "png".into(),
            dir.to_string_lossy().to_string(),
        )
        .expect("gif→png 拆帧");
        assert_eq!(paths.len(), 3, "3 帧应输出 3 张");
        assert!(paths[0].ends_with("anim_001.png"), "三位零填充: {}", paths[0]);
        assert!(paths[2].ends_with("anim_003.png"), "末帧编号: {}", paths[2]);

        // 动画 GIF → gif:单文件动画保持
        let paths = convert_image(
            gif_src.to_string_lossy().to_string(),
            "gif".into(),
            dir.to_string_lossy().to_string(),
        )
        .expect("gif→gif 重编码");
        assert_eq!(paths.len(), 1, "动画→GIF 应单文件");
        let bytes = std::fs::read(&paths[0]).unwrap();
        let info = sniff_info(&mut Cursor::new(&bytes), "gif");
        assert!(info.animated && info.frame_count == 3, "动画应保持: {info:?}");

        // 非法目标格式 / 不存在目录 / AVIF 源
        assert!(call("svg").is_err(), "SVG 不做目标");
        assert!(call("avif").is_err(), "AVIF 不做目标");
        let err = convert_image(src.to_string_lossy().to_string(), "png".into(), dir.join("no_dir").to_string_lossy().to_string());
        assert!(err.unwrap_err().contains("输出目录不存在"));
        let avif_src = dir.join("x.avif");
        std::fs::write(&avif_src, b"stub").unwrap();
        assert!(
            convert_image(avif_src.to_string_lossy().to_string(), "png".into(), dir.to_string_lossy().to_string()).is_err(),
            "AVIF 源应拒绝"
        );

        std::fs::remove_dir_all(&dir).ok();
    }

    /// JPEG 编码对透明源白底压平(有 alpha 输入不炸、输出 RGB)。
    #[test]
    fn jpeg_flattens_alpha() {
        let mut buf = image::RgbaImage::new(4, 4);
        for (_, _, p) in buf.enumerate_pixels_mut() {
            *p = image::Rgba([255, 0, 0, 128]);
        }
        let jpg = encode_single(&DynamicImage::ImageRgba8(buf), TargetFormat::Jpeg).unwrap();
        let back = image::load_from_memory(&jpg).unwrap();
        let p = back.to_rgba8().get_pixel(2, 2).0;
        // 半透明红 + 白底 ≈ (255,127,127);JPEG 有损给 ±16 容差
        assert!((p[0] as i32 - 255).abs() < 16, "R 应近 255: {}", p[0]);
        assert!((p[1] as i32 - 127).abs() < 16, "G 应近 127: {}", p[1]);
        assert!((p[2] as i32 - 127).abs() < 16, "B 应近 127: {}", p[2]);
    }

    /// 16 位源 → PNG 保位深;→ JPEG 正常降 8 位。
    #[test]
    fn png_keeps_16bit_depth() {
        let img16 = DynamicImage::ImageRgba16(image::ImageBuffer::<image::Rgba<u16>, Vec<u16>>::new(4, 4));
        let png = encode_single(&img16, TargetFormat::Png).unwrap();
        let back = image::load_from_memory(&png).unwrap();
        assert!(matches!(back, DynamicImage::ImageRgba16(_)), "16 位应保持");
        let jpg = encode_single(&img16, TargetFormat::Jpeg).unwrap();
        assert!(image::load_from_memory(&jpg).is_ok(), "降 8 位应可解码");
    }

    /// EXIF 方向应用:Rotate90 交换宽高(解码链的方向正确性由手动清单覆盖)。
    #[test]
    fn applies_orientation() {
        let mut img = rgba8(20, 10);
        img.apply_orientation(Orientation::Rotate90);
        assert_eq!((img.width(), img.height()), (10, 20), "Rotate90 应交换宽高");
    }

    /// 命名纯逻辑:ICO 尺寸字段 0 → 256;编号三位零填充且 >999 自然增位。
    #[test]
    fn naming_helpers() {
        assert_eq!(ico_size_byte(0), 0);
        assert_eq!(ico_size_byte(255), 255);
        assert_eq!(ico_size_byte(256), 0);
        assert_eq!(ico_size_byte(512), 0);
        assert_eq!(format!("{:03}", 1u32), "001");
        assert_eq!(format!("{:03}", 1000u32), "1000", "超三位自然增位");
    }
}
