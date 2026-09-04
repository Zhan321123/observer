//! 格式识别(design.md §2 两级识别 + method.md §2):
//! 1. 扩展名初筛(kind_for_ext,与前端 registry.kindForExt 保持一致);
//! 2. 魔数/结构嗅探(sniff),拿不准时读文件头兜底。

use std::fs;
use std::io::Read;
use std::path::Path;

/// 扩展名 → 类别(快路径)。与前端 formats/registry.ts 同序同覆盖。
pub fn kind_for_ext(ext: &str) -> &'static str {
    match ext {
        "png" | "jpg" | "jpeg" | "gif" | "webp" | "svg" | "svgz" | "bmp" | "ico" | "avif"
        | "apng" | "tiff" | "tif" | "tga" | "dds" | "qoi" | "hdr" | "exr" | "heic" | "heif"
        | "psd" | "psb" | "cr2" | "cr3" | "nef" | "arw" | "orf" | "rw2" | "dng" | "raf"
        | "pef" | "srw" | "x3f" | "iiq" => "image",

        "mp4" | "webm" | "m4v" | "ogv" | "ogm" | "mkv" | "m2ts" | "mts" | "m4s" | "mov"
        | "wmv" | "asf" | "flv" | "vob" | "rm" | "rmvb" | "3gp" | "y4m" | "avi" | "mpg"
        | "mpeg" | "hevc" => "video",

        "mp3" | "wav" | "ogg" | "oga" | "m4a" | "aac" | "flac" | "opus" | "weba" | "ape"
        | "wv" | "tta" | "wma" | "aiff" | "aif" | "aifc" | "dsf" | "dff" | "amr" | "ac3"
        | "dts" | "caf" | "voc" | "w64" | "mka" | "mid" | "midi" | "mod" | "xm" | "s3m"
        | "it" => "audio",

        "md" | "markdown" | "mdown" | "mkd" => "markdown",

        // 电子表格(第二批:xlsx 支持,SheetJS 解析)
        "xlsx" | "xls" | "xlsm" | "ods" => "spreadsheet",

        // 文档(task2 二:docx/pptx,zip 容器,docx-preview/pptx-browser 渲染;
        // "压缩包目录"由功能条 docMode 附加切换,循 xlsx 双身份先例)
        "docx" | "pptx" => "document",

        // 字体(task2 二:FontFace 样张 + opentype.js 字形表)
        "ttf" | "otf" | "woff" | "woff2" | "ttc" => "font",

        // SQLite(task2 二:rusqlite 只读浏览)
        "db" | "sqlite" | "sqlite3" | "db3" => "sqlite",

        // PDF(第三批:pdf.js 渲染)
        "pdf" => "pdf",

        // 3D 模型(M4:three.js loaders;dxf 为 CAD 图纸,task2 三,走同一管道自绘)
        "gltf" | "glb" | "obj" | "fbx" | "stl" | "ply" | "dae" | "3ds" | "3mf" | "pcd"
        | "bvh" | "vox" | "dxf" => "threed",

        // DWG(AutoCAD 闭源二进制,task2 三):独立 kind,前端只给占位说明(引导导出 DXF)
        "dwg" => "dwg",

        // 动效(M4:dotLottie / Rive / SVGA;Lottie 的 .json 走 text 嗅探)
        "lottie" | "riv" | "svga" => "anim",

        // 压缩包(task2):目录树预览。jar/epub 无原生预览,默认即压缩包目录;
        // docx/pptx 已移居 document(task2 二);iWork(pages/numbers/key)同为 zip 容器,
        // 先给目录树(task2 一);xlsx/xlsm 本质也是 zip 容器但保持 spreadsheet(默认路由),
        // "压缩包目录"只是功能条的附加视角;.7z.001 等分卷不加(走 unknown→魔数嗅探,首卷给占位提示)。
        "zip" | "rar" | "7z" | "jar" | "epub" | "pages" | "numbers" | "key" => "archive",

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
        // 压缩包(task2):魔数/容器细分结果。xlsx 容器保持 spreadsheet(默认路由),
        // 伪装成 .bin 的 xlsx 也会被纠正到表格;docx/pptx → document(task2 二);
        // jar/epub → archive。
        "zip" | "rar4" | "rar5" | "7z" | "jar" | "epub" => "archive",
        "docx" | "pptx" => "document",
        "xlsx" => "spreadsheet",
        // 字体/SQLite 魔数(task2 二):伪装成 .bin 的字体/库也会被纠正
        "ttf" | "otf" | "woff" | "woff2" | "ttc" => "font",
        "sqlite" => "sqlite",
        // DWG 魔数(task2 三):版本码 AC1015/AC1018/AC1021/AC1024/AC1027/AC1032,
        // 统一前缀 AC10 + 两位数字;命中只纠正 kind(前端仍为占位说明)
        "dwg" => "dwg",
        _ => match fallback {
            "image" => "image",
            "video" => "video",
            "audio" => "audio",
            "markdown" => "markdown",
            "spreadsheet" => "spreadsheet",
            "document" => "document",
            "font" => "font",
            "sqlite" => "sqlite",
            "pdf" => "pdf",
            "threed" => "threed",
            "anim" => "anim",
            "archive" => "archive",
            "text" => "text",
            "dwg" => "dwg",
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

    // 压缩包(task2 §2 魔数表):zip(空包可能只有 EOCD)/ RAR4 / RAR5 / 7z。
    // 须在文本嗅探之前——"7z\xBC\xAF" 前两字节是可打印 ASCII,会被 sniff_text 误吞。
    if n >= 4 && (&b[0..4] == b"PK\x03\x04" || &b[0..4] == b"PK\x05\x06") {
        return Some("zip");
    }
    if n >= 7 && &b[0..7] == b"Rar!\x1A\x07\x00" {
        return Some("rar4");
    }
    if n >= 8 && &b[0..8] == b"Rar!\x1A\x07\x01\x00" {
        return Some("rar5");
    }
    if n >= 6 && &b[0..6] == b"7z\xBC\xAF\x27\x1C" {
        return Some("7z");
    }

    // 字体魔数(task2 二):sfnt(0x00010000 TrueType / OTTO CFF / ttcf 集合)与 woff/woff2。
    // 0x00010000 前 4 字节含 NUL,不会被 sniff_text 误吞,但保持二进制段在前、文本嗅探在后的次序。
    if n >= 4 && &b[0..4] == b"OTTO" {
        return Some("otf");
    }
    if n >= 4 && &b[0..4] == b"ttcf" {
        return Some("ttc");
    }
    if n >= 4 && &b[0..4] == b"wOFF" {
        return Some("woff");
    }
    if n >= 4 && &b[0..4] == b"wOF2" {
        return Some("woff2");
    }
    if n >= 4 && b[0..4] == [0x00, 0x01, 0x00, 0x00] {
        return Some("ttf");
    }
    // SQLite(task2 二):头 16 字节 "SQLite format 3\0"
    if n >= 16 && &b[0..15] == b"SQLite format 3" {
        return Some("sqlite");
    }

    // DWG(task2 三):头 6 字节版本码 "AC10" + 两位数字(AC1015=2000 … AC1032=2018+)。
    // 须在文本嗅探之前——前缀是可打印 ASCII,会被 sniff_text 误吞成 text。
    if n >= 6 && &b[0..4] == b"AC10" && b[4].is_ascii_digit() && b[5].is_ascii_digit() {
        return Some("dwg");
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

#[cfg(test)]
mod tests {
    use super::*;

    /// kind_for_ext 须与前端 registry.ts 的 handler 覆盖一致(单一事实来源,两端对齐)。
    #[test]
    fn kind_for_ext_covers_threed_and_anim() {
        // 3D 模型(M4;dxf 为 CAD 图纸,task2 三)
        for e in ["gltf", "glb", "obj", "fbx", "stl", "ply", "dae", "3ds", "3mf", "pcd", "bvh", "vox", "dxf"] {
            assert_eq!(kind_for_ext(e), "threed", "ext {e} 应为 threed");
        }
        // 动效(M4:dotLottie/Rive/SVGA)
        for e in ["lottie", "riv", "svga"] {
            assert_eq!(kind_for_ext(e), "anim", "ext {e} 应为 anim");
        }
        // 回归:既有类别不受影响
        assert_eq!(kind_for_ext("png"), "image");
        assert_eq!(kind_for_ext("mp4"), "video");
        assert_eq!(kind_for_ext("mp3"), "audio");
        assert_eq!(kind_for_ext("pdf"), "pdf");
        assert_eq!(kind_for_ext("json"), "text"); // Lottie 的 .json 仍走 text 嗅探
        assert_eq!(kind_for_ext("xyz"), "unknown");
    }

    /// 压缩包扩展名(task2):archive 类;docx/pptx 已移居 document(task2 二);xlsx 保持 spreadsheet。
    #[test]
    fn kind_for_ext_covers_archive() {
        for e in ["zip", "rar", "7z", "jar", "epub", "pages", "numbers", "key"] {
            assert_eq!(kind_for_ext(e), "archive", "ext {e} 应为 archive");
        }
        // 双身份:xlsx 本质是 zip 容器,但默认仍是表格("压缩包目录"只是功能条附加视角)
        assert_eq!(kind_for_ext("xlsx"), "spreadsheet");
        assert_eq!(kind_for_ext("xlsm"), "spreadsheet");
        // 分卷扩展名不进 archive(走 unknown→魔数嗅探)
        assert_eq!(kind_for_ext("001"), "unknown");
        assert_eq!(kind_for_ext("z01"), "unknown");
    }

    /// task2 二:字体 / SQLite / 文档(docx/pptx 从 archive 移居 document,默认渲染文档)。
    #[test]
    fn kind_for_ext_covers_task2_batch2() {
        for e in ["ttf", "otf", "woff", "woff2", "ttc"] {
            assert_eq!(kind_for_ext(e), "font", "ext {e} 应为 font");
        }
        for e in ["db", "sqlite", "sqlite3", "db3"] {
            assert_eq!(kind_for_ext(e), "sqlite", "ext {e} 应为 sqlite");
        }
        for e in ["docx", "pptx"] {
            assert_eq!(kind_for_ext(e), "document", "ext {e} 应为 document");
        }
    }

    /// task2 一零成本扩充:apng/svgz、amr 等 FFmpeg 直解音频、pef 等 RAW、ogm、iWork 容器。
    #[test]
    fn kind_for_ext_covers_task2_batch1() {
        for e in ["apng", "svgz", "pef", "srw", "x3f", "iiq"] {
            assert_eq!(kind_for_ext(e), "image", "ext {e} 应为 image");
        }
        for e in ["amr", "ac3", "dts", "caf", "aifc", "voc", "w64", "mka"] {
            assert_eq!(kind_for_ext(e), "audio", "ext {e} 应为 audio");
        }
        assert_eq!(kind_for_ext("ogm"), "video");
        for e in ["pages", "numbers", "key"] {
            assert_eq!(kind_for_ext(e), "archive", "ext {e} 应为 archive");
        }
        // 回归:同前缀既有项不受影响
        assert_eq!(kind_for_ext("m4a"), "audio");
        assert_eq!(kind_for_ext("mkv"), "video");
        assert_eq!(kind_for_ext("aiff"), "audio");
    }

    /// 压缩包嗅探结果 → kind(魔数命中;xlsx 容器细分纠正回 spreadsheet;docx/pptx → document)。
    #[test]
    fn kind_for_sniff_archive() {
        for s in ["zip", "rar4", "rar5", "7z", "jar", "epub"] {
            assert_eq!(kind_for_sniff(s, "unknown"), "archive", "嗅探 {s} 应为 archive");
        }
        for s in ["docx", "pptx"] {
            assert_eq!(kind_for_sniff(s, "unknown"), "document", "嗅探 {s} 应为 document");
        }
        assert_eq!(kind_for_sniff("xlsx", "archive"), "spreadsheet");
        // task2 二魔数:字体 / SQLite
        for s in ["ttf", "otf", "woff", "woff2", "ttc"] {
            assert_eq!(kind_for_sniff(s, "unknown"), "font", "嗅探 {s} 应为 font");
        }
        assert_eq!(kind_for_sniff("sqlite", "unknown"), "sqlite");
        // fallback 透传:ext 已判 archive、嗅探不认识时保留 archive
        assert_eq!(kind_for_sniff("something-else", "archive"), "archive");
    }

    /// kind_for_sniff 的 fallback 透传新类别(未命中嗅探时保留 ext 判断)。
    #[test]
    fn kind_for_sniff_fallback_keeps_new_kinds() {
        assert_eq!(kind_for_sniff("something-else", "threed"), "threed");
        assert_eq!(kind_for_sniff("something-else", "anim"), "anim");
        assert_eq!(kind_for_sniff("something-else", "font"), "font");
        assert_eq!(kind_for_sniff("something-else", "sqlite"), "sqlite");
        assert_eq!(kind_for_sniff("something-else", "document"), "document");
        assert_eq!(kind_for_sniff("something-else", "dwg"), "dwg");
        assert_eq!(kind_for_sniff("lottie", "text"), "text");
    }

    /// CAD(task2 三):dxf 挂 threed 管道;dwg 独立 kind(前端占位),魔数嗅探可识别伪装扩展。
    #[test]
    fn kind_for_cad() {
        assert_eq!(kind_for_ext("dxf"), "threed");
        assert_eq!(kind_for_ext("dwg"), "dwg");
        assert_eq!(kind_for_sniff("dwg", "unknown"), "dwg");
        // 嗅探不认识时保留 ext 判断
        assert_eq!(kind_for_sniff("something-else", "dwg"), "dwg");
    }

    /// 字体/SQLite 魔数嗅探(task2 二):伪装成 .bin 等未知扩展名也能识别。
    #[test]
    fn sniffs_font_and_sqlite_magic() {
        let dir = std::env::temp_dir();
        let mut check = |name: &str, bytes: &[u8], want: &str| {
            let p = dir.join(format!("observer_sniff_{name}_{}", std::process::id()));
            std::fs::write(&p, bytes).unwrap();
            assert_eq!(sniff(&p), Some(want), "{name} 嗅探不符");
        };
        check("ttf.bin", &[0x00, 0x01, 0x00, 0x00, 0, 0, 0, 0], "ttf");
        check("otf.bin", b"OTTO\0\0\0\0", "otf");
        check("ttc.bin", b"ttcf\0\0\0\0", "ttc");
        check("woff.bin", b"wOFF\0\0\0\0", "woff");
        check("woff2.bin", b"wOF2\0\0\0\0", "woff2");
        check("sqlite.bin", b"SQLite format 3\0rest", "sqlite");
        // DWG 魔数(task2 三):AC10 版本码前缀(含老版本 AC1009 等)
        check("dwg.bin", b"AC1015\0\0\0", "dwg");
        check("dwg-old.bin", b"AC1009\0\0", "dwg");
    }
}
