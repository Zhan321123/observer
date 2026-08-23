//! 格式识别(design.md §2 两级识别 + method.md §2):
//! 1. 扩展名初筛(kind_for_ext,与前端 registry.kindForExt 保持一致);
//! 2. 魔数/结构嗅探(sniff),拿不准时读文件头兜底。

use std::fs;
use std::io::Read;
use std::path::Path;

/// 扩展名 → 类别(快路径)。与前端 formats/registry.ts 同序同覆盖。
pub fn kind_for_ext(ext: &str) -> &'static str {
    match ext {
        "png" | "jpg" | "jpeg" | "gif" | "webp" | "svg" | "bmp" | "ico" | "avif" | "tiff"
        | "tif" | "tga" | "dds" | "qoi" | "hdr" | "exr" | "heic" | "heif" | "psd" | "psb"
        | "cr2" | "cr3" | "nef" | "arw" | "orf" | "rw2" | "dng" | "raf" => "image",

        "mp4" | "webm" | "m4v" | "ogv" | "mkv" | "m2ts" | "mts" | "m4s" | "mov"
        | "wmv" | "asf" | "flv" | "vob" | "rm" | "rmvb" | "3gp" | "y4m" | "avi" | "mpg"
        | "mpeg" | "hevc" => "video",

        "mp3" | "wav" | "ogg" | "oga" | "m4a" | "aac" | "flac" | "opus" | "weba" | "ape"
        | "wv" | "tta" | "wma" | "aiff" | "aif" | "dsf" | "dff" | "mid" | "midi" | "mod"
        | "xm" | "s3m" | "it" => "audio",

        "md" | "markdown" | "mdown" | "mkd" => "markdown",

        // 电子表格(第二批:xlsx 支持,SheetJS 解析)
        "xlsx" | "xls" | "xlsm" | "ods" => "spreadsheet",

        // PDF(第三批:pdf.js 渲染)
        "pdf" => "pdf",

        "txt" | "json" | "js" | "mjs" | "cjs" | "ts" | "tsx" | "jsx" | "rs" | "py" | "css"
        | "scss" | "less" | "html" | "htm" | "xml" | "yml" | "yaml" | "toml" | "ini" | "conf"
        | "cfg" | "log" | "csv" | "tsv" | "c" | "h" | "cpp" | "cc" | "hpp" | "cs" | "java"
        | "go" | "sh" | "bash" | "bat" | "ps1" | "sql" | "vue" | "svelte" | "lock"
        | "gitignore" | "env" => "text",

        _ => "unknown",
    }
}

/// 嗅探结果 → 类别(用于修正 ext 判断;拿不准则回退 fallback)。
pub fn kind_for_sniff(sniff: &str, fallback: &str) -> &'static str {
    match sniff {
        "mp4" | "webm" | "mov" | "mpegts" => "video",
        "wav" | "mp3" | "ogg" | "flac" | "aiff" => "audio",
        "png" | "jpeg" | "gif" | "webp" | "bmp" | "avif" => "image",
        // Lottie 是 JSON,本轮仍按文本预览(3D 等后续)
        "lottie" | "json" | "text" => "text",
        // PDF(第三批:pdf.js 渲染)
        "pdf" => "pdf",
        _ => match fallback {
            "image" => "image",
            "video" => "video",
            "audio" => "audio",
            "markdown" => "markdown",
            "spreadsheet" => "spreadsheet",
            "pdf" => "pdf",
            "text" => "text",
            _ => "unknown",
        },
    }
}

/// 读文件头做魔数/结构嗅探。返回简写格式名(供上报与修正 kind)。
pub fn sniff(path: &Path) -> Option<&'static str> {
    let mut buf = [0u8; 512];
    let n = fs::File::open(path).ok()?.read(&mut buf).ok()?;
    if n == 0 {
        return None;
    }
    let b = &buf[..n];

    // mp4/m4s/mov:offset 4 起 "ftyp" box
    if n >= 8 && &b[4..8] == b"ftyp" {
        return Some("mp4");
    }
    // MPEG-TS(.ts):同步字节 0x47 开头(且每隔 188 字节重复)。用于区分 TypeScript 文本(.ts)。
    if b[0] == 0x47 && n >= 188 * 2 && b[188] == 0x47 {
        return Some("mpegts");
    }
    // RIFF(WAV/AVI):再看 wave 标记
    if n >= 12 && &b[0..4] == b"RIFF" {
        if &b[8..12] == b"WAVE" {
            return Some("wav");
        }
        if &b[8..12] == b"AVI " {
            return Some("mp4"); // AVI 走视频容器
        }
        if &b[8..12] == b"WEBP" {
            return Some("webp");
        }
    }
    if n >= 4 && &b[0..4] == b"OggS" {
        return Some("ogg");
    }
    if n >= 4 && &b[0..4] == b"fLaC" {
        return Some("flac");
    }
    if n >= 4 && &b[0..4] == b"FORM" {
        return Some("aiff");
    }
    // MP3:ID3 标签或帧同步 0xFF 0xFB/FA/F3
    if n >= 3 && (&b[0..3] == b"ID3" || (b[0] == 0xFF && (b[1] & 0xE0) == 0xE0)) {
        return Some("mp3");
    }
    // 图片魔数
    if n >= 8 && &b[0..8] == b"\x89PNG\r\n\x1a\n" {
        return Some("png");
    }
    if n >= 3 && &b[0..3] == b"\xFF\xD8\xFF" {
        return Some("jpeg");
    }
    if n >= 6 && (&b[0..6] == b"GIF87a" || &b[0..6] == b"GIF89a") {
        return Some("gif");
    }
    if n >= 2 && &b[0..2] == b"BM" {
        return Some("bmp");
    }
    if n >= 12 && &b[4..12] == b"ftypavif" {
        return Some("avif");
    }
    if n >= 4 && &b[0..4] == b"%PDF" {
        return Some("pdf");
    }
    // WebM/MKV:EBML 头 0x1A45DFA3
    if n >= 4 && &b[0..4] == b"\x1A\x45\xDF\xA3" {
        return Some("webm");
    }

    // Lottie 嗅探:JSON 且含 v/fr/ip/op/layers 五件套(method.md §2)
    if let Some(text) = sniff_text(b) {
        if looks_like_lottie(text) {
            return Some("lottie");
        }
        if text.trim_start().starts_with('{') || text.trim_start().starts_with('[') {
            return Some("json");
        }
        return Some("text");
    }
    None
}

/// 若文件头基本是可打印 UTF-8 文本则返回之(用于 Lottie/JSON 嗅探)。
fn sniff_text(b: &[u8]) -> Option<&str> {
    let s = std::str::from_utf8(b).ok()?;
    let printable = s.chars().all(|c| !c.is_control() || c.is_whitespace());
    if printable {
        Some(s)
    } else {
        None
    }
}

fn looks_like_lottie(s: &str) -> bool {
    let t = s.trim_start();
    t.starts_with('{')
        && t.contains("\"v\"")
        && t.contains("\"fr\"")
        && t.contains("\"ip\"")
        && t.contains("\"op\"")
        && t.contains("\"layers\"")
}
