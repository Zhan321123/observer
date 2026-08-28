// task2 压缩包目录预览:ZIP / RAR4 / RAR5 / 7z 的"只列条目元数据"——
// 只读中央目录 / 头,不读任何文件数据(守铁律 2:IPC 只传元数据,字节根本不取)。
// zip 另提供容器细分 classify_zip,供格式识别层区分 jar / xlsx / docx / pptx / epub(task2 §2 表)。
// 密码只用于列目录(task2 §4):rar -hp / 7z -mhe=on 的头加密包需密码才能读头;
// 数据加密(zip 常见、未加密文件名的 rar)不影响列目录,条目带锁标记、不弹密码框。

use serde::Serialize;
use std::fs::File;
use std::io::{BufReader, Read};
use std::path::Path;

/// 压缩包条目元数据(IPC 载荷;snake_case 与 commands.rs DirEntry 同风格)。
#[derive(Debug, Clone, Serialize)]
pub struct EntryMeta {
    /// 包内相对路径,统一 '/' 分隔(rar 在 Windows 下是 '\',已归一)
    pub path: String,
    /// 最后一段文件名
    pub name: String,
    pub is_dir: bool,
    /// 解压后大小
    pub size: u64,
    /// unix 秒;无值记 0(zip/rar 的 DOS 时间 2 秒分辨率、1980 起)
    pub mtime: i64,
    /// 条目数据加密(锁标记;7z 头结构不暴露 per-entry 标志,恒 false)
    pub encrypted: bool,
}

/// 压缩包错误(本代码库第一个结构化命令错误):前端按 kind 分支——
/// header_encrypted / wrong_password → 密码框视图;其余 → 宫格内错误占位(task2 §3/§4)。
/// 邻接标签序列化:单元变体 {"kind":"header_encrypted"};newtype {"kind":"corrupted","message":"…"}。
/// (不能用内部标签 #[serde(tag)]:newtype 变体直接持 String 时 derive 直接编译报错。)
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", content = "message", rename_all = "snake_case")]
pub enum ArchiveError {
    /// 文件头加密且无密码(rar -hp / 7z -mhe=on),不输密码无法列目录
    HeaderEncrypted,
    /// 提供的密码不对
    WrongPassword,
    /// 损坏 / 结构异常
    Corrupted(String),
    /// 不支持(分卷暂缓、未知压缩方法等)
    Unsupported(String),
    /// 打不开 / IO 错误
    Io(String),
    /// 魔数不匹配(不是 zip/rar/7z)
    NotArchive(String),
}

/// 读文件头判压缩格式(task2 §2 魔数表;7z 签名 6 字节 + 2 字节版本)。
fn detect_kind(head: &[u8]) -> Option<&'static str> {
    if head.starts_with(b"PK\x03\x04") || head.starts_with(b"PK\x05\x06") {
        return Some("zip"); // 空包只有 EOCD(PK\x05\x06)
    }
    if head.starts_with(b"Rar!\x1A\x07\x00") {
        return Some("rar4");
    }
    if head.starts_with(b"Rar!\x1A\x07\x01\x00") {
        return Some("rar5");
    }
    if head.starts_with(b"7z\xBC\xAF\x27\x1C") {
        return Some("7z");
    }
    None
}

/// 列压缩包目录。pwd 仅 rar/7z 头加密时需要(zip 列目录永不需要密码)。
/// 错误分类见 ArchiveError(前端据此切密码框视图)。
#[tauri::command]
pub fn archive_list(path: String, pwd: Option<String>) -> Result<Vec<EntryMeta>, ArchiveError> {
    let p = Path::new(&path);
    let mut head = [0u8; 8];
    let n = File::open(p)
        .and_then(|mut f| f.read(&mut head))
        .map_err(|e| ArchiveError::Io(e.to_string()))?;
    match detect_kind(&head[..n]) {
        Some("zip") => list_zip(p),
        Some("rar4") | Some("rar5") => list_rar(p, pwd.as_deref()),
        Some("7z") => list_7z(p, pwd.as_deref()),
        _ => Err(ArchiveError::NotArchive(format!(
            "不是支持的压缩包(zip/rar/7z): {path}"
        ))),
    }
}

// ---- zip ----

/// zip:只走中央目录。by_index_raw 不装解密/解压通道 → 数据加密条目也能无密码列出
/// (带锁标记);zip 没有"头加密"形态,中央目录永远明文。
fn list_zip(path: &Path) -> Result<Vec<EntryMeta>, ArchiveError> {
    let file = File::open(path).map_err(|e| ArchiveError::Io(e.to_string()))?;
    let mut zip = zip::ZipArchive::new(BufReader::new(file)).map_err(map_zip_err)?;
    let mut out = Vec::with_capacity(zip.len());
    for i in 0..zip.len() {
        let f = zip.by_index_raw(i).map_err(map_zip_err)?;
        let is_dir = f.is_dir();
        // 归一:统一 '/' 分隔 + 去尾 /(PS 5.1 Compress-Archive 等会写 '\' 分隔的非常规条目名)
        let p = f.name().replace('\\', "/");
        let p = p.trim_end_matches('/');
        out.push(EntryMeta {
            name: p.rsplit('/').next().unwrap_or("").to_string(),
            path: p.to_string(),
            is_dir,
            size: f.size(),
            mtime: f.last_modified().map(zip_dt_to_unix).unwrap_or(0),
            encrypted: f.encrypted(),
        });
    }
    Ok(out) // 空包(PK\x05\x06)自然得到空 Vec
}

/// zip 容器细分(task2 §2 表):返回 "jar"|"xlsx"|"docx"|"pptx"|"epub"|None(普通 zip)。
/// 只在 detect_format 嗅探命中 PK 魔数后调用,每次打开文件至多一次;
/// 只解析中央目录,epub 额外读一个 STORED 条目(mimetype)的 ≤30 字节。
pub fn classify_zip(path: &Path) -> Option<&'static str> {
    let file = File::open(path).ok()?;
    let mut zip = zip::ZipArchive::new(BufReader::new(file)).ok()?;
    let names: Vec<String> = zip.file_names().map(str::to_owned).collect();
    if names.iter().any(|n| n == "META-INF/MANIFEST.MF") {
        return Some("jar");
    }
    if names.iter().any(|n| n == "[Content_Types].xml") {
        if names.iter().any(|n| n.starts_with("xl/")) {
            return Some("xlsx");
        }
        if names.iter().any(|n| n.starts_with("word/")) {
            return Some("docx");
        }
        if names.iter().any(|n| n.starts_with("ppt/")) {
            return Some("pptx");
        }
    }
    // epub:首条目名必须是 mimetype,内容 application/epub+zip(规范要求 STORED,无需解压器)
    if names.first().map(|n| n.as_str()) == Some("mimetype") {
        if let Ok(mut f) = zip.by_index_raw(0) {
            let mut buf = [0u8; 30];
            if let Ok(n) = f.read(&mut buf) {
                if &buf[..n] == b"application/epub+zip" {
                    return Some("epub");
                }
            }
        }
    }
    None
}

fn map_zip_err(e: zip::result::ZipError) -> ArchiveError {
    use zip::result::ZipError as Z;
    match e {
        Z::Io(io) => ArchiveError::Io(io.to_string()),
        Z::InvalidArchive(m) => ArchiveError::Corrupted(m.to_string()),
        // 列目录不触解压;结构层面的不支持按损坏处理(中央目录不完整/截断)
        Z::UnsupportedArchive(m) => ArchiveError::Corrupted(format!("不支持的 zip 结构: {m}")),
        Z::FileNotFound => ArchiveError::Corrupted("条目缺失".into()),
        Z::InvalidPassword => ArchiveError::WrongPassword,
        _ => ArchiveError::Corrupted(e.to_string()), // ZipError 为 non_exhaustive
    }
}

// ---- rar ----

/// rar4/rar5:open_for_listing 只读头、跳过载荷。头加密(-hp)时密码校验发生在
/// 首个头读取 → open 与迭代两条路径都要套同一错误映射;数据加密(未加密文件名)
/// 可无密码照常列出(is_encrypted 锁标记,不弹框)。
fn list_rar(path: &Path, pwd: Option<&str>) -> Result<Vec<EntryMeta>, ArchiveError> {
    // task2 §6:分卷整体暂缓(is_multipart 为纯文件名启发式:.partNN.rar / .rNN)
    if unrar::Archive::new(path).is_multipart() {
        return Err(ArchiveError::Unsupported("分卷压缩暂不支持".into()));
    }
    let had_pwd = pwd.is_some();
    let arc = match pwd {
        Some(p) => unrar::Archive::with_password(path, p),
        None => unrar::Archive::new(path),
    };
    let mut out = Vec::new();
    let open = arc
        .open_for_listing()
        .map_err(|e| map_unrar_err(&e, had_pwd))?;
    for item in open {
        let h = item.map_err(|e| map_unrar_err(&e, had_pwd))?;
        let p = h.filename.to_string_lossy().replace('\\', "/");
        out.push(EntryMeta {
            name: p.rsplit('/').next().unwrap_or("").to_string(),
            path: p,
            is_dir: h.is_directory(),
            size: h.unpacked_size,
            mtime: dos_raw_to_unix(h.file_time),
            encrypted: h.is_encrypted(),
        });
    }
    Ok(out)
}

fn map_unrar_err(e: &unrar::error::UnrarError, had_pwd: bool) -> ArchiveError {
    use unrar::error::Code;
    match e.code {
        Code::MissingPassword => ArchiveError::HeaderEncrypted,
        Code::BadPassword => {
            // 未传密码却报 BadPassword → 防御性按头加密处理(前端照常出密码框)
            if had_pwd {
                ArchiveError::WrongPassword
            } else {
                ArchiveError::HeaderEncrypted
            }
        }
        _ => ArchiveError::Corrupted(e.to_string()),
    }
}

// ---- 7z ----

/// 7z:`Archive::open` 只解析头(含头流 LZMA 解码),零数据解码——不用 SevenZReader
/// (其 for_each_entries 会驱动数据解码,违背"只列元数据")。
fn list_7z(path: &Path, pwd: Option<&str>) -> Result<Vec<EntryMeta>, ArchiveError> {
    // task2 §6:.7z.001/.002… 分卷按文件名启发式整体暂缓
    if is_split_7z_name(path) {
        return Err(ArchiveError::Unsupported("分卷压缩暂不支持".into()));
    }
    let had_pwd = pwd.is_some();
    let archive = match pwd {
        Some(p) => sevenz_rust::Archive::open_with_password(
            path,
            &sevenz_rust::Password::from(p),
        ),
        None => sevenz_rust::Archive::open(path),
    }
    .map_err(|e| map_7z_err(e, had_pwd))?;
    Ok(archive
        .files
        .iter()
        .map(|e| {
            let p = e.name().to_string();
            EntryMeta {
                name: p.rsplit('/').next().unwrap_or("").to_string(),
                path: p,
                is_dir: e.is_directory(),
                size: e.size(),
                mtime: if e.has_last_modified_date {
                    nt_ft_to_unix(e.last_modified_date())
                } else {
                    0
                },
                // 7z 头结构无 per-entry 加密标志(加密要么在头级 -mhe=on,要么只在数据流)
                encrypted: false,
            }
        })
        .collect())
}

/// .7z.001 / .7z.002 …(尾段 3 位数字、主名以 .7z 结尾)→ 分卷
fn is_split_7z_name(path: &Path) -> bool {
    let name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let Some(idx) = name.rfind('.') else {
        return false;
    };
    let (stem, tail) = (&name[..idx], &name[idx + 1..]);
    tail.len() == 3 && tail.bytes().all(|b| b.is_ascii_digit()) && stem.ends_with(".7z")
}

fn map_7z_err(e: sevenz_rust::Error, had_pwd: bool) -> ArchiveError {
    use sevenz_rust::Error as E;
    let msg = e.to_string();
    match e {
        E::PasswordRequired => ArchiveError::HeaderEncrypted,
        E::MaybeBadPassword(_) if had_pwd => ArchiveError::WrongPassword,
        E::MaybeBadPassword(_) => ArchiveError::HeaderEncrypted,
        E::Io(io, _) | E::FileOpen(io, _) => ArchiveError::Io(io.to_string()),
        E::UnsupportedVersion { .. }
        | E::UnsupportedCompressionMethod(_)
        | E::Unsupported(_)
        | E::ExternalUnsupported => ArchiveError::Unsupported(msg),
        _ => ArchiveError::Corrupted(msg),
    }
}

// ---- 时间换算(无新依赖) ----

/// Howard Hinnant days_from_civil(公域算法):公历年月日 → 自 1970-01-01 的天数。
fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400; // [0, 399]
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + d - 1; // [0, 365]
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy; // [0, 146096]
    era * 146097 + doe - 719468
}

/// DOS 日期时间位布局(zip 与 rar 同源:date 高 16 位 / time 低 16 位,秒粒度 ×2,1980 起)。
fn dos_raw_to_unix(raw: u32) -> i64 {
    let date = (raw >> 16) as i64;
    let time = (raw & 0xFFFF) as i64;
    let y = 1980 + (date >> 9);
    let mo = (date >> 5) & 0xF;
    let d = date & 0x1F;
    let h = (time >> 11) & 0x1F;
    let mi = (time >> 5) & 0x3F;
    let s = (time & 0x1F) * 2;
    if !(1..=12).contains(&mo) || !(1..=31).contains(&d) {
        return 0; // 非法位(损坏头)按无时间处理
    }
    days_from_civil(y, mo, d) * 86400 + h * 3600 + mi * 60 + s
}

/// zip::DateTime(本地时间的 DOS 时间,无时区)→ unix 秒。
fn zip_dt_to_unix(dt: zip::DateTime) -> i64 {
    days_from_civil(dt.year() as i64, dt.month() as i64, dt.day() as i64) * 86400
        + dt.hour() as i64 * 3600
        + dt.minute() as i64 * 60
        + dt.second() as i64
}

/// NT FILETIME(1601-01-01 起、100ns 单位)→ unix 秒;1970 前饱和为 0。
fn nt_ft_to_unix(ft: sevenz_rust::nt_time::FileTime) -> i64 {
    let raw = u64::from(ft);
    ((raw as i64 - 116_444_736_000_000_000) / 10_000_000).max(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn tmp(name: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!("observer_archive_{name}_{}", std::process::id()))
    }

    /// 用 zip crate 造测试样本(default-features=false → 一律 STORED,无需压缩 feature)。
    fn write_zip(path: &Path, entries: &[(&str, &str)]) {
        let f = File::create(path).unwrap();
        let mut w = zip::ZipWriter::new(f);
        let opt = zip::write::SimpleFileOptions::default();
        for (name, data) in entries {
            w.start_file(*name, opt).unwrap();
            w.write_all(data.as_bytes()).unwrap();
        }
        w.finish().unwrap();
    }

    #[test]
    fn detect_kind_magic_table() {
        assert_eq!(detect_kind(b"PK\x03\x04\x14\x00\x00\x00"), Some("zip"));
        assert_eq!(detect_kind(b"PK\x05\x06\x00\x00\x00\x00"), Some("zip")); // 空包 EOCD
        assert_eq!(detect_kind(b"Rar!\x1A\x07\x00\xAB"), Some("rar4"));
        assert_eq!(detect_kind(b"Rar!\x1A\x07\x01\x00\xAB"), Some("rar5"));
        assert_eq!(detect_kind(b"7z\xBC\xAF\x27\x1C\x00\x04"), Some("7z")); // 6 字节签名 + 2 字节版本
        assert_eq!(detect_kind(b"\x89PNG\r\n\x1a"), None);
        assert_eq!(detect_kind(b"hello world!"), None);
    }

    #[test]
    fn time_conversions() {
        assert_eq!(days_from_civil(1970, 1, 1), 0);
        assert_eq!(days_from_civil(1980, 1, 1) * 86400, 315_532_800);
        assert_eq!(days_from_civil(2024, 1, 1) * 86400, 1_704_067_200);
        // 1980-01-01 00:00 的 DOS 位布局:date=(0<<9)|(1<<5)|1=0x21,time=0
        assert_eq!(dos_raw_to_unix(0x0021_0000), 315_532_800);
        assert_eq!(dos_raw_to_unix(0), 0); // 非法位 → 0
    }

    #[test]
    fn archive_error_serde_shape() {
        assert_eq!(
            serde_json::to_value(ArchiveError::HeaderEncrypted).unwrap(),
            serde_json::json!({"kind": "header_encrypted"})
        );
        assert_eq!(
            serde_json::to_value(ArchiveError::Corrupted("x".into())).unwrap(),
            serde_json::json!({"kind": "corrupted", "message": "x"})
        );
    }

    #[test]
    fn classify_zip_containers() {
        let jar = tmp("jar.zip");
        write_zip(&jar, &[("META-INF/MANIFEST.MF", "Manifest-Version: 1.0")]);
        assert_eq!(classify_zip(&jar), Some("jar"));

        let epub = tmp("epub.zip");
        write_zip(&epub, &[("mimetype", "application/epub+zip")]);
        assert_eq!(classify_zip(&epub), Some("epub"));

        let xlsx = tmp("xlsx.zip");
        write_zip(&xlsx, &[("[Content_Types].xml", "<Types/>"), ("xl/workbook.xml", "<wb/>")]);
        assert_eq!(classify_zip(&xlsx), Some("xlsx"));

        let docx = tmp("docx.zip");
        write_zip(&docx, &[("[Content_Types].xml", "<Types/>"), ("word/document.xml", "<d/>")]);
        assert_eq!(classify_zip(&docx), Some("docx"));

        let plain = tmp("plain.zip");
        write_zip(&plain, &[("a.txt", "hi")]);
        assert_eq!(classify_zip(&plain), None);

        // mimetype 内容不对 → 不是 epub(普通 zip)
        let fake = tmp("fake_epub.zip");
        write_zip(&fake, &[("mimetype", "text/plain")]);
        assert_eq!(classify_zip(&fake), None);
    }

    #[test]
    fn archive_list_zip_and_empty() {
        let p = tmp("list.zip");
        write_zip(&p, &[("dir/", ""), ("dir/a.txt", "hello"), ("b.txt", "x")]);
        let entries = archive_list(p.to_string_lossy().to_string(), None).unwrap();
        assert_eq!(entries.len(), 3);
        let dir = entries.iter().find(|e| e.path == "dir").unwrap(); // 尾 / 已归一去除
        assert!(dir.is_dir);
        let a = entries.iter().find(|e| e.path == "dir/a.txt").unwrap();
        assert_eq!(a.name, "a.txt");
        assert_eq!(a.size, 5);
        assert!(!a.encrypted);

        // 空包:仅 EOCD → 空列表
        let empty = tmp("empty.zip");
        write_zip(&empty, &[]);
        assert!(archive_list(empty.to_string_lossy().to_string(), None)
            .unwrap()
            .is_empty());

        // 非 zip 头 → NotArchive
        let not = tmp("not.bin");
        std::fs::write(&not, b"plain text").unwrap();
        assert!(matches!(
            archive_list(not.to_string_lossy().to_string(), None),
            Err(ArchiveError::NotArchive(_))
        ));
    }

    #[test]
    fn split_7z_name() {
        assert!(is_split_7z_name(Path::new("a.7z.001")));
        assert!(is_split_7z_name(Path::new("A.7Z.002")));
        assert!(!is_split_7z_name(Path::new("a.7z")));
        assert!(!is_split_7z_name(Path::new("a.001"))); // 主名不以 .7z 结尾 → 不拦
        assert!(!is_split_7z_name(Path::new("a.7z.0001")));
    }

    /// 真实世界 zip 样本(PowerShell Compress-Archive 生成,含中文/嵌套目录;
    /// PS 5.1 条目名可能用 '\' 分隔,由前端树构建归一)。无 PowerShell 则跳过。
    #[test]
    fn archive_list_realworld_zip() {
        let dir = std::env::temp_dir();
        let pid = std::process::id();
        let src = dir.join(format!("observer_e2e_src_{pid}"));
        let out = dir.join(format!("observer_e2e_{pid}.zip"));
        let ps = format!(
            "$d='{}'; New-Item -ItemType Directory -Force \"$d\\中文目录\\嵌套\" | Out-Null; \
             Set-Content \"$d\\中文目录\\嵌套\\文件.txt\" 'hello'; Set-Content \"$d\\a.txt\" 'world'; \
             Compress-Archive -Path \"$d\\*\" -DestinationPath '{}' -Force",
            src.display(),
            out.display()
        );
        let ok = std::process::Command::new("powershell")
            .args(["-NoProfile", "-Command", &ps])
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false);
        if !ok {
            return; // 无 PowerShell(非 Windows CI)→ 跳过
        }
        let entries = archive_list(out.to_string_lossy().to_string(), None).expect("list real zip");
        // 中文条目必须存在,且路径已归一为 '/' 分隔(PS 5.1 条目名原生是 '\')
        let hit = entries.iter().any(|e| e.path == "中文目录/嵌套/文件.txt" && e.name == "文件.txt");
        assert!(hit, "未找到归一后的中文条目,实际: {:?}", entries.iter().map(|e| &e.path).collect::<Vec<_>>());
        // 隐式父目录(中文目录/嵌套)由前端树构建补出;这里只验条目本身
        assert!(entries.iter().all(|e| !e.encrypted), "明文包不应有加密标记");
        let _ = std::fs::remove_file(&out);
        let _ = std::fs::remove_dir_all(&src);
    }

    /// 7z 真实读写往返:sevenz-rust 自带 lzma2 编码器先写出,再走 archive_list 的
    /// 只读头路径(Archive::open + files 元数据),验证整条 7z 列目录链路。
    #[test]
    fn archive_list_7z_roundtrip() {
        let dir = std::env::temp_dir();
        let pid = std::process::id();
        let src = dir.join(format!("observer_e2e_{pid}_src.txt"));
        let out = dir.join(format!("observer_e2e_{pid}.7z"));
        std::fs::write(&src, b"sevenz payload").unwrap();
        {
            let mut zw = sevenz_rust::SevenZWriter::create(&out).expect("create 7z writer");
            let entry = sevenz_rust::SevenZArchiveEntry::from_path(&src, "dir/file.txt".to_string());
            zw.push_archive_entry(entry, Some(File::open(&src).unwrap()))
                .expect("push entry");
            zw.finish().expect("finish 7z");
        }
        let entries = archive_list(out.to_string_lossy().to_string(), None).expect("list 7z");
        assert_eq!(entries.len(), 1, "实际: {entries:?}");
        assert_eq!(entries[0].path, "dir/file.txt");
        assert_eq!(entries[0].size, b"sevenz payload".len() as u64);
        assert!(entries[0].mtime > 0, "from_path 携带源文件 mtime,实际 {}", entries[0].mtime);
        let _ = std::fs::remove_file(&out);
        let _ = std::fs::remove_file(&src);
    }
}
