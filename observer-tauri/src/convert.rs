//! M5 格式转换(首片:3D 导出产物落盘,design.md §4 / task.md M5)。
//!
//! fs 插件对 JS 侧只授权了应用目录,Rust std::fs 不受 capabilities 约束——
//! 转换产物写任意用户目录由此走自建命令。这是铁律 2(媒体字节不走 IPC)的
//! 首个**输出侧**例外:产物由 WebView(three.js exporter)生成,asset:// 输入管道
//! 不适用;v1 以 base64 经 JSON 单命令传输(单任务、MB 级,~1.33x 膨胀可接受)。

use base64::engine::general_purpose::STANDARD;
use base64::Engine as _;
use std::path::{Path, PathBuf};

/// 重名去重上限:`a.glb` 被占则 `a (1).glb` … `a (9999).glb`,仍占则报错(绝不覆盖)。
const MAX_DEDUPE: u32 = 9999;

/// 目录内首个未占用路径:优先原名,被占则 `stem (n).ext`(n 从 1 起)。
/// 多级后缀按最后一段扩展名拆(model.v1.glb → model.v1 (1).glb);无扩展名 README → README (1)。
fn unique_path(dir: &Path, filename: &str) -> Result<PathBuf, String> {
    let p = Path::new(filename);
    let stem = p.file_stem().and_then(|s| s.to_str()).unwrap_or(filename);
    let ext = p.extension().and_then(|e| e.to_str());
    let candidate = |n: Option<u32>| -> PathBuf {
        match n {
            None => dir.join(filename),
            Some(n) => dir.join(match ext {
                Some(e) => format!("{stem} ({n}).{e}"),
                None => format!("{stem} ({n})"),
            }),
        }
    };
    if !candidate(None).exists() {
        return Ok(candidate(None));
    }
    for n in 1..=MAX_DEDUPE {
        let c = candidate(Some(n));
        if !c.exists() {
            return Ok(c);
        }
    }
    Err("输出目录中同名文件过多".to_string())
}

/// 同目录临时文件 + rename 原子落位(避免半写成品被当作有效文件)。
/// Windows 的 rename 不覆盖已存在文件,与 unique_path 配合天然成立;失败时清理临时文件。
fn write_atomic(final_path: &Path, bytes: &[u8]) -> Result<(), String> {
    let file_name = final_path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    let tmp = final_path
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .join(format!("{file_name}.tmp-{}", std::process::id()));
    if let Err(e) = std::fs::write(&tmp, bytes) {
        return Err(format!("写入失败: {e}"));
    }
    match std::fs::rename(&tmp, final_path) {
        Ok(()) => Ok(()),
        Err(e) => {
            let _ = std::fs::remove_file(&tmp); // 收拾半成品
            Err(format!("写入失败: {e}"))
        }
    }
}

/// 转换产物写入 dir/filename(重名自动加 " (n)",绝不覆盖既有文件),返回最终写入路径。
#[tauri::command]
pub fn convert_write(dir: String, filename: String, data_b64: String) -> Result<String, String> {
    let filename = filename.trim();
    if filename.is_empty() {
        return Err("输出文件名不能为空".to_string());
    }
    if filename.contains('/') || filename.contains('\\') || filename == "." || filename == ".." {
        return Err("文件名不能包含路径分隔符".to_string());
    }
    let dir_path = Path::new(&dir);
    if !dir_path.is_dir() {
        return Err(format!("输出目录不存在: {dir}"));
    }
    let bytes = STANDARD
        .decode(data_b64)
        .map_err(|e| format!("输出数据解码失败: {e}"))?;
    let final_path = unique_path(dir_path, filename)?;
    write_atomic(&final_path, &bytes)?;
    // 不 canonicalize:Windows 会得 \\?\ 前缀,污染前端显示与 reveal_in_explorer
    Ok(final_path.to_string_lossy().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 每个用例独立的临时目录(temp + 用例名 + pid,防并发互踩)。
    fn tmp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("observer_convert_{name}_{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn call(dir: &Path, filename: &str, data: &[u8]) -> Result<String, String> {
        convert_write(
            dir.to_string_lossy().to_string(),
            filename.to_string(),
            STANDARD.encode(data),
        )
    }

    /// 碰撞去重:预置 a.txt 后连写两次 → a (1).txt / a (2).txt;原文件内容不动(绝不覆盖)。
    #[test]
    fn dedupes_on_collision_without_overwrite() {
        let dir = tmp("dedupe");
        std::fs::write(dir.join("a.txt"), b"original").unwrap();
        let p1 = call(&dir, "a.txt", b"data1").expect("第一次应成功");
        assert!(p1.ends_with("a (1).txt"), "首次应去重到 (1),实际 {p1}");
        let p2 = call(&dir, "a.txt", b"data2").expect("第二次应成功");
        assert!(p2.ends_with("a (2).txt"), "第二次应去重到 (2),实际 {p2}");
        assert_eq!(std::fs::read(dir.join("a.txt")).unwrap(), b"original", "原文件绝不能被覆盖");
        assert_eq!(std::fs::read(&p1).unwrap(), b"data1", "(1) 内容应完整写入");
        std::fs::remove_dir_all(&dir).ok();
    }

    /// 多级后缀:扩展名只拆最后一段(model.v1.glb → model.v1 (1).glb)。
    #[test]
    fn keeps_multi_dot_stem() {
        let dir = tmp("multidot");
        std::fs::write(dir.join("model.v1.glb"), b"x").unwrap();
        let p = call(&dir, "model.v1.glb", b"y").expect("成功");
        assert!(p.ends_with("model.v1 (1).glb"), "主名应保留多级后缀,实际 {p}");
        std::fs::remove_dir_all(&dir).ok();
    }

    /// 无扩展名:README → README (1)。
    #[test]
    fn no_extension_dedupes() {
        let dir = tmp("noext");
        std::fs::write(dir.join("README"), b"x").unwrap();
        let p = call(&dir, "README", b"y").expect("成功");
        assert!(p.ends_with("README (1)"), "无扩展名应得 README (1),实际 {p}");
        std::fs::remove_dir_all(&dir).ok();
    }

    /// 无冲突:原名直写,内容 round-trip 一致;不留临时文件。
    #[test]
    fn writes_clean_name_and_roundtrips() {
        let dir = tmp("clean");
        let p = call(&dir, "out.glb", b"GLB-bytes").expect("成功");
        assert!(p.ends_with("out.glb"), "无冲突应直用原名,实际 {p}");
        assert_eq!(std::fs::read(&p).unwrap(), b"GLB-bytes");
        let leftovers: Vec<_> = std::fs::read_dir(&dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().contains(".tmp-"))
            .collect();
        assert!(leftovers.is_empty(), "不应残留临时文件");
        std::fs::remove_dir_all(&dir).ok();
    }

    /// 拒绝路径:空名 / 含分隔符 / `..`;非法 base64;目录不存在。
    #[test]
    fn rejects_bad_input() {
        let dir = tmp("reject");
        assert!(call(&dir, "  ", b"x").is_err(), "空名应拒绝");
        assert!(call(&dir, "a/b.glb", b"x").is_err(), "含 / 应拒绝");
        assert!(call(&dir, "a\\b.glb", b"x").is_err(), "含 \\ 应拒绝");
        assert!(call(&dir, "..", b"x").is_err(), ".. 应拒绝");
        let err = convert_write(
            dir.to_string_lossy().to_string(),
            "a.glb".into(),
            "!!!not-base64!!!".to_string(),
        );
        assert!(err.is_err(), "非法 base64 应拒绝");
        let err = convert_write(
            dir.join("no_such_dir").to_string_lossy().to_string(),
            "a.glb".into(),
            STANDARD.encode(b"x"),
        );
        assert!(err.unwrap_err().contains("输出目录不存在"), "应报目录不存在");
        std::fs::remove_dir_all(&dir).ok();
    }
}
