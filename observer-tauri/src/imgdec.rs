//! M2 图片解码(design.md §5⑤,method.md §5):纯 Rust 解码 → PNG 位图,前端经 asset:// 显示(铁律 1/2)。
//!
//! 覆盖:image crate(tiff/tga/exr/dds/qoi/hdr)+ psd crate(psd/psb 取合成图)。
//! RAW(crawler)/ HEIC(imazen/heic)本轮不做(依赖最重,后续里程碑)。
//! 解码结果走磁盘缓存(key = path+size+mtime),与 video_thumbnail 同一模式;
//! 超大图先按比例缩再编码,避免 GB 级 TIFF/PSD 撑爆 WebView。

use std::path::Path;

/// 预览用最大像素数(100MP);超出按比例缩,避免超大图卡顿/内存暴涨。
const MAX_PIXELS: f64 = 100_000_000.0;

fn mtime_secs(meta: &std::fs::Metadata) -> i64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// 解码为 DynamicImage(按扩展名分发;psd 走 psd crate,其余走 image crate 指定格式)。
fn decode(bytes: &[u8], ext: &str) -> Result<image::DynamicImage, String> {
    if matches!(ext, "psd" | "psb") {
        return decode_psd(bytes);
    }
    let fmt = match ext {
        "tiff" | "tif" => image::ImageFormat::Tiff,
        "tga" => image::ImageFormat::Tga,
        "dds" => image::ImageFormat::Dds,
        "qoi" => image::ImageFormat::Qoi,
        "hdr" => image::ImageFormat::Hdr,
        "exr" => image::ImageFormat::OpenExr,
        other => return Err(format!("暂不支持解码的图片格式: {other}")),
    };
    image::load_from_memory_with_format(bytes, fmt).map_err(|e| format!("解码失败: {e}"))
}

/// PSD/PSB:取合成图(所有图层拍平)→ RGBA8。
fn decode_psd(bytes: &[u8]) -> Result<image::DynamicImage, String> {
    let psd = psd::Psd::from_bytes(bytes).map_err(|e| format!("PSD 解析失败: {e:?}"))?;
    let (w, h) = (psd.width(), psd.height());
    let rgba = psd.rgba();
    let buf = image::RgbaImage::from_raw(w, h, rgba)
        .ok_or_else(|| "PSD 合成图像素尺寸与宽高不符".to_string())?;
    Ok(image::DynamicImage::ImageRgba8(buf))
}

/// 按比例缩到 max_pixels 以内(保宽高比)。
fn downscale_to(img: image::DynamicImage, max_pixels: f64) -> image::DynamicImage {
    let (w, h) = (img.width(), img.height());
    let pixels = w as f64 * h as f64;
    if pixels <= max_pixels || w == 0 || h == 0 {
        return img;
    }
    let scale = (max_pixels / pixels).sqrt();
    let nw = ((w as f64) * scale).max(1.0) as u32;
    let nh = ((h as f64) * scale).max(1.0) as u32;
    img.resize(nw, nh, image::imageops::FilterType::Triangle)
}

/// 解码图片到磁盘缓存 PNG,返回路径(前端经 asset:// 加载)。
#[tauri::command]
pub fn decode_image(app: tauri::AppHandle, path: String) -> Result<String, String> {
    use tauri::Manager;
    let p = Path::new(&path);
    let ext = p
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
    let meta_fs = std::fs::metadata(&path).map_err(|e| format!("无法读取文件: {e}"))?;

    // 缓存 key:路径 + 长度 + mtime(文件改动后自动失效重解码)
    let key = format!("{:x}", {
        use std::hash::{Hash, Hasher};
        let mut h = std::collections::hash_map::DefaultHasher::new();
        path.hash(&mut h);
        meta_fs.len().hash(&mut h);
        mtime_secs(&meta_fs).hash(&mut h);
        h.finish()
    });
    let dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?
        .join("thumbs");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let out = dir.join(format!("dec_{key}.png"));
    if out.is_file() {
        return Ok(out.to_string_lossy().to_string());
    }

    let bytes = std::fs::read(&path).map_err(|e| format!("无法读取文件: {e}"))?;
    let img = decode(&bytes, &ext)?;
    // 统一转 RGBA8(EXR/HDR 的 f32 高光会截断到 255,预览可接受),再按需缩放、编码 PNG。
    let img = image::DynamicImage::ImageRgba8(img.to_rgba8());
    let img = downscale_to(img, MAX_PIXELS);
    img.save(&out).map_err(|e| format!("PNG 编码失败: {e}"))?;
    if out.is_file() {
        Ok(out.to_string_lossy().to_string())
    } else {
        Err("解码产物未生成".to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 造一张 8x4 RGBA 图,按 fmt 编码到内存,再经 decode 解码回来,校验尺寸。
    fn roundtrip(ext: &str, fmt: image::ImageFormat) {
        let mut buf = image::RgbaImage::new(8, 4);
        for (x, y, p) in buf.enumerate_pixels_mut() {
            *p = image::Rgba([(x * 30) as u8, (y * 60) as u8, 128, 255]);
        }
        let img = image::DynamicImage::ImageRgba8(buf);
        let mut cursor = std::io::Cursor::new(Vec::new());
        img.write_to(&mut cursor, fmt).expect("编码样本");
        let back = decode(&cursor.into_inner(), ext).expect("解码");
        assert_eq!((back.width(), back.height()), (8, 4), "{ext} 解码尺寸不符");
    }

    #[test]
    fn decodes_tga_qoi_tiff() {
        roundtrip("tga", image::ImageFormat::Tga);
        roundtrip("qoi", image::ImageFormat::Qoi);
        roundtrip("tiff", image::ImageFormat::Tiff);
    }

    #[test]
    fn downscale_caps_pixels_and_keeps_aspect() {
        let img = image::DynamicImage::ImageRgba8(image::RgbaImage::new(200, 100)); // 20k px
        let s = downscale_to(img, 5_000.0);
        let px = s.width() as f64 * s.height() as f64;
        assert!(px <= 5_000.0 * 1.05, "缩放后应≤上限,实际 {px}");
        assert_eq!(s.width(), s.height() * 2, "宽高比应保持 2:1");
    }

    #[test]
    fn downscale_noop_when_small() {
        let img = image::DynamicImage::ImageRgba8(image::RgbaImage::new(10, 10));
        let s = downscale_to(img, MAX_PIXELS);
        assert_eq!((s.width(), s.height()), (10, 10));
    }
}
