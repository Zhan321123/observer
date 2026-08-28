use serde::Serialize;
use std::fs;
use std::path::Path;
use std::time::UNIX_EPOCH;
use tauri::Manager;

use crate::formats;

#[derive(Serialize)]
pub struct DirEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
    pub mtime: i64,
    pub ext: String,
}

#[derive(Serialize)]
pub struct FileStat {
    pub name: String,
    pub path: String,
    pub size: u64,
    pub mtime: i64,
    pub ext: String,
    pub is_dir: bool,
}

#[derive(Serialize)]
pub struct DetectResult {
    pub ext: String,
    pub sniffed: Option<String>,
    pub kind: String,
}

fn ext_of(path: &Path) -> String {
    path.extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase()
}

fn mtime_secs(meta: &fs::Metadata) -> i64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// 列出一个目录的直接子项(文件夹在前、文件在后,各自按名称排序)。
/// 单个坏项跳过,不让整个列表失败。
#[tauri::command]
pub fn list_dir(path: String) -> Result<Vec<DirEntry>, String> {
    let read = fs::read_dir(&path).map_err(|e| format!("无法读取目录 {path}: {e}"))?;
    let mut dirs: Vec<DirEntry> = Vec::new();
    let mut files: Vec<DirEntry> = Vec::new();

    for entry in read.flatten() {
        let p = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        // 跳过隐藏项(以 . 开头)
        if name.starts_with('.') {
            continue;
        }
        let meta = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };
        let is_dir = meta.is_dir();
        let item = DirEntry {
            path: p.to_string_lossy().to_string(),
            name,
            is_dir,
            size: if is_dir { 0 } else { meta.len() },
            mtime: mtime_secs(&meta),
            ext: if is_dir { String::new() } else { ext_of(&p) },
        };
        if is_dir {
            dirs.push(item);
        } else {
            files.push(item);
        }
    }

    let key = |e: &DirEntry| e.name.to_lowercase();
    dirs.sort_by(|a, b| key(a).cmp(&key(b)));
    files.sort_by(|a, b| key(a).cmp(&key(b)));
    dirs.extend(files);
    Ok(dirs)
}

// 1 GiB 灾难性护栏:真正的"大小阈值 + 确认后显示"在前端(设置项 textMaxSizeMB,默认 10MB),
// 后端只防一次读入撑爆 WebView。超过此值仍拒绝。
const MAX_TEXT_BYTES: u64 = 1024 * 1024 * 1024;

/// 读文本文件(UTF-8,有损容错)。仅元数据级文本,媒体字节绝不走这里(铁律 2)。
#[tauri::command]
pub fn read_text_file(path: String) -> Result<String, String> {
    let meta = fs::metadata(&path).map_err(|e| format!("无法读取文件信息: {e}"))?;
    if meta.len() > MAX_TEXT_BYTES {
        return Err(format!("文件过大(>{} MiB),暂不按文本预览", MAX_TEXT_BYTES / 1024 / 1024));
    }
    let bytes = fs::read(&path).map_err(|e| format!("无法读取文件: {e}"))?;
    Ok(String::from_utf8_lossy(&bytes).to_string())
}

/// 解析 Markdown 链接为本地文件绝对路径(供"本地链接→新宫格打开")。
/// 外链(http/https/mailto 等)返回 None,由前端走浏览器。相对路径基于 base_file 所在目录。
/// 仅当解析后的目标确实存在且为文件时返回其规范化绝对路径,否则 None。
#[tauri::command]
pub fn resolve_link(base_file: String, href: String) -> Option<String> {
    // 去掉查询/锚点;percent 解码;剥 file:// 前缀
    let mut h = href.split(['#', '?']).next().unwrap_or("").trim().to_string();
    if let Some(rest) = h.strip_prefix("file://") {
        h = rest.trim_start_matches('/').to_string();
    }
    if h.is_empty() {
        return None;
    }
    // 带 scheme 的(http:// https:// mailto: 等)→ 非本地文件,交前端走浏览器
    if h.contains("://") || h.starts_with("mailto:") {
        return None;
    }
    let decoded = percent_decode(&h);
    let p = Path::new(&decoded);
    let candidate = if p.is_absolute() {
        p.to_path_buf()
    } else {
        Path::new(&base_file).parent()?.join(p)
    };
    let canon = candidate.canonicalize().ok()?;
    if canon.is_file() {
        Some(canon.to_string_lossy().to_string())
    } else {
        None
    }
}

/// 最小 percent 解码(处理 %20 等)。非法序列原样保留。
fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(hex) = std::str::from_utf8(&bytes[i + 1..i + 3]) {
                if let Ok(v) = u8::from_str_radix(hex, 16) {
                    out.push(v);
                    i += 3;
                    continue;
                }
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).to_string()
}

/// 文件元数据(文件信息 frame)。
#[tauri::command]
pub fn file_stat(path: String) -> Result<FileStat, String> {
    let p = Path::new(&path);
    let meta = fs::metadata(p).map_err(|e| format!("无法读取文件信息: {e}"))?;
    let name = p
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| path.clone());
    Ok(FileStat {
        name,
        path: path.clone(),
        size: meta.len(),
        mtime: mtime_secs(&meta),
        ext: ext_of(p),
        is_dir: meta.is_dir(),
    })
}

/// 在系统资源管理器中显示该文件(包 opener 插件;自建命令,省 opener capability)。
#[tauri::command]
pub fn reveal_in_explorer(path: String) -> Result<(), String> {
    tauri_plugin_opener::reveal_item_in_dir(&path).map_err(|e| e.to_string())
}

/// 格式识别(§2 两级:扩展名初筛 + 魔数嗅探兜底)。
#[tauri::command]
pub fn detect_format(path: String) -> Result<DetectResult, String> {
    let p = Path::new(&path);
    let ext = ext_of(p);
    let mut kind = formats::kind_for_ext(&ext).to_string();

    // 歧义/空扩展名/archive 类 → 读文件头嗅探兜底(zip 族不看扩展名下结论:
    // jar/epub/docx/pptx 靠包内特征条目细分,task2 §2)
    let mut sniffed = if matches!(ext.as_str(), "" | "json" | "m4s" | "bin" | "dat")
        || kind == "unknown"
        || kind == "archive"
    {
        formats::sniff(p).map(|s| s.to_string())
    } else {
        None
    };
    // zip 魔数 → 容器细分(task2 §2 表):jar/epub/docx/pptx→archive;xlsx→spreadsheet
    // (伪装成 .bin 的 xlsx 也会被纠正到表格);普通 zip 维持 "zip"。
    if sniffed.as_deref() == Some("zip") {
        if let Some(sub) = crate::archive::classify_zip(p) {
            sniffed = Some(sub.to_string());
        }
    }
    if let Some(s) = &sniffed {
        // 嗅探结果可修正 kind(例如 .json 实为 Lottie → 仍归 text,但上报实际格式)
        kind = formats::kind_for_sniff(s, &kind).to_string();
    }

    // mp4 家族容器可能是纯音频(B站 audio.m4s / .m4a 等):按容器嗅探只能得到 "video",
    // 需 ffprobe 看流——无视频流但有音频流 → 归为 audio,走原生音频预览(asset:// 直放 AAC-in-MP4,
    // 比 ffmpeg fMP4 流在 <video> 里播纯音频可靠得多)。probe 失败则维持原判,优雅回退。
    let mp4_family = sniffed.as_deref() == Some("mp4")
        || matches!(ext.as_str(), "mp4" | "m4v" | "m4s" | "mov" | "3gp" | "m4a");
    if kind == "video" && mp4_family {
        if let Ok(meta) = crate::ffmpeg::probe(&path) {
            if meta.video_codec.is_none() && meta.audio_codec.is_some() {
                kind = "audio".to_string();
            }
        }
    }

    Ok(DetectResult { ext, sniffed, kind })
}

/// 运行时给 asset 协议授权用户打开的目录/文件(配合静态宽 scope 双保险)。
#[tauri::command]
pub fn allow_asset_path(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let p = Path::new(&path);
    let scope = app.asset_protocol_scope();
    let r = if p.is_dir() {
        scope.allow_directory(p, true)
    } else {
        scope.allow_file(p)
    };
    r.map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command;

    fn gen(args: &[&str], out: &std::path::Path) {
        let status = Command::new(crate::ffmpeg::ffmpeg_path().expect("ffmpeg"))
            .args(["-hide_banner", "-loglevel", "error", "-y"])
            .args(args)
            .arg(out)
            .status()
            .expect("spawn ffmpeg");
        assert!(status.success(), "生成测试文件失败: {}", out.display());
    }

    /// 纯音频 m4s(B站 audio.m4s = AAC-in-MP4)应判为 audio;含视频流的 m4s 仍为 video。
    #[test]
    fn detect_format_distinguishes_audio_only_m4s() {
        let dir = std::env::temp_dir();
        let audio = dir.join("observer_detect_audio.m4s");
        let video = dir.join("observer_detect_video.m4s");
        gen(
            &["-f", "lavfi", "-i", "sine=frequency=440:duration=2", "-c:a", "aac", "-movflags", "frag_keyframe", "-f", "mp4"],
            &audio,
        );
        gen(
            &["-f", "lavfi", "-i", "testsrc=duration=2:size=160x120:rate=25", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "frag_keyframe", "-f", "mp4"],
            &video,
        );

        let da = detect_format(audio.to_string_lossy().to_string()).expect("detect audio");
        assert_eq!(da.kind, "audio", "纯音频 m4s 应判为 audio,实际 {}", da.kind);
        let dv = detect_format(video.to_string_lossy().to_string()).expect("detect video");
        assert_eq!(dv.kind, "video", "含视频流 m4s 应判为 video,实际 {}", dv.kind);
    }

    /// task2:zip 族 detect_format 全链路 —— archive 类触发嗅探 + classify_zip 容器细分。
    #[test]
    fn detect_format_classifies_zip_containers() {
        use std::io::Write;
        let dir = std::env::temp_dir();
        // name 含扩展名;entries 为 (条目名, 内容)
        let mk = |name: &str, entries: &[(&str, &str)]| -> String {
            let p = dir.join(format!("observer_detect_{}_{name}", std::process::id()));
            let f = fs::File::create(&p).unwrap();
            let mut w = zip::ZipWriter::new(f);
            let opt = zip::write::SimpleFileOptions::default();
            for (n, d) in entries {
                w.start_file(*n, opt).unwrap();
                w.write_all(d.as_bytes()).unwrap();
            }
            w.finish().unwrap();
            p.to_string_lossy().to_string()
        };

        // 普通 zip:ext zip → 嗅探确认,kind archive
        let d = detect_format(mk("plain.zip", &[("a.txt", "hi")])).unwrap();
        assert_eq!((d.ext.as_str(), d.kind.as_str()), ("zip", "archive"));

        // jar / docx / epub:细分上报 sniffed,kind archive
        let d = detect_format(mk("j.jar", &[("META-INF/MANIFEST.MF", "Manifest-Version: 1.0")])).unwrap();
        assert_eq!((d.sniffed.as_deref(), d.kind.as_str()), (Some("jar"), "archive"));
        let d = detect_format(mk("w.docx", &[("[Content_Types].xml", "<T/>"), ("word/document.xml", "<d/>")])).unwrap();
        assert_eq!((d.sniffed.as_deref(), d.kind.as_str()), (Some("docx"), "archive"));
        let d = detect_format(mk("b.epub", &[("mimetype", "application/epub+zip")])).unwrap();
        assert_eq!((d.sniffed.as_deref(), d.kind.as_str()), (Some("epub"), "archive"));

        // 伪装成 .bin 的 xlsx:细分 xlsx → 纠正回 spreadsheet(默认路由)
        let real = mk("x.xlsx", &[("[Content_Types].xml", "<T/>"), ("xl/workbook.xml", "<w/>")]);
        let bin = dir.join(format!("observer_detect_xlsx_{}.bin", std::process::id()));
        std::fs::copy(&real, &bin).unwrap();
        let d = detect_format(bin.to_string_lossy().to_string()).unwrap();
        assert_eq!((d.ext.as_str(), d.sniffed.as_deref(), d.kind.as_str()), ("bin", Some("xlsx"), "spreadsheet"));
    }
}
