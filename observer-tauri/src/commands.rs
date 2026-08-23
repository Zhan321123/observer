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

const MAX_TEXT_BYTES: u64 = 5 * 1024 * 1024; // 5 MiB 护栏

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

    // 歧义/空扩展名 → 读文件头嗅探兜底
    let sniffed = if matches!(ext.as_str(), "" | "json" | "m4s" | "bin" | "dat") || kind == "unknown" {
        formats::sniff(p).map(|s| s.to_string())
    } else {
        None
    };
    if let Some(s) = &sniffed {
        // 嗅探结果可修正 kind(例如 .json 实为 Lottie → 仍归 text,但上报实际格式)
        kind = formats::kind_for_sniff(s, &kind).to_string();
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
