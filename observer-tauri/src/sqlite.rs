//! SQLite 浏览(task2 二):rusqlite 只读浏览用户 .db 文件(表清单 / 分页读行)。
//!
//! 铁律 2:IPC 只回 JSON(表元数据/当前页行数据);BLOB 以占位符出,数据库字节不走 IPC。
//! 连接为命令级(每次调用打开、用完即弃)——预览工具的调用频率下开销可忽略,
//! 也免去了用户库的生命周期管理(应用自有库才进 db.rs 的 managed state)。

use rusqlite::{params, Connection, OpenFlags};
use rusqlite::types::ValueRef;
use serde::Serialize;
use std::path::Path;

/// SQLite 浏览的结构化错误(与 archive::ArchiveError 同款 serde 邻接标签,前端判别联合消费)。
/// not_sqlite 特判:很多 .db 其实是 LevelDB/LMDB 等,给友好中文而非底层报错。
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", content = "message", rename_all = "snake_case")]
pub enum SqliteError {
    NotFound(String),
    NotSqlite(String),
    OpenFailed(String),
    QueryFailed(String),
}

#[derive(Debug, Serialize)]
pub struct SqliteTable {
    pub name: String,
    /// "table" | "view"
    pub kind: String,
    /// 建表 DDL(结构面板显示;视图/自动表可能为空)
    pub ddl: String,
}

#[derive(Serialize)]
pub struct SqlitePage {
    pub columns: Vec<String>,
    /// 值为 JSON:NULL/整数/浮点/字符串;BLOB 出占位符(铁律 2)
    pub rows: Vec<Vec<serde_json::Value>>,
    /// 总行数(COUNT(*),大表可能慢;视图为全扫描)
    pub total: i64,
}

/// 只读打开。WAL 陷阱:纯 READ_ONLY 在 -shm 缺失/不可写时会失败(Windows 常见);
/// immutable=1 虽能开但会忽略 -wal 内容读到旧数据,禁用。
/// 回退链:READ_ONLY → 失败则读写打开 + PRAGMA query_only=ON(仍拒绝一切写)。
fn open_readonly(path: &str) -> Result<Connection, SqliteError> {
    let p = Path::new(path);
    if !p.is_file() {
        return Err(SqliteError::NotFound("文件不存在".to_string()));
    }
    // 魔数自校验(防扩展名路由失手):头 16 字节 "SQLite format 3\0"
    let mut header = [0u8; 16];
    match std::fs::File::open(p).and_then(|mut f| std::io::Read::read_exact(&mut f, &mut header)) {
        Ok(()) => {
            if &header != b"SQLite format 3\0" {
                return Err(SqliteError::NotSqlite(
                    "不是有效的 SQLite 数据库(可能是其他格式的 .db,或已加密)".to_string(),
                ));
            }
        }
        Err(e) => return Err(SqliteError::OpenFailed(format!("无法读取文件头: {e}"))),
    }
    let ro = OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX;
    match Connection::open_with_flags(p, ro) {
        Ok(c) => Ok(c),
        Err(ro_err) => {
            // WAL 库:READ_ONLY 开不了(需可写 -shm)→ 读写打开 + query_only(拒绝一切写)
            let c = Connection::open_with_flags(p, ro | OpenFlags::SQLITE_OPEN_READ_WRITE)
                .map_err(|e| {
                    SqliteError::OpenFailed(format!(
                        "数据库打开失败(可能被其他程序锁定): {e}(只读尝试: {ro_err})"
                    ))
                })?;
            c.execute_batch("PRAGMA query_only=ON;")
                .map_err(|e| SqliteError::OpenFailed(format!("query_only 设置失败: {e}")))?;
            Ok(c)
        }
    }
}

/// 表名/标识符安全引号:标识符无法参数绑定 → 双引号包裹、内部引号双写;拒绝空名/含 NUL。
fn quote_ident(name: &str) -> Result<String, SqliteError> {
    if name.is_empty() || name.contains('\0') {
        return Err(SqliteError::QueryFailed("非法表名".to_string()));
    }
    Ok(format!("\"{}\"", name.replace('"', "\"\"")))
}

/// 列出全部用户表与视图(过滤 sqlite_ 内部表;表在前、视图在后,各自按名排序)。
#[tauri::command]
pub fn sqlite_tables(path: String) -> Result<Vec<SqliteTable>, SqliteError> {
    let conn = open_readonly(&path)?;
    let mut stmt = conn
        .prepare(
            "SELECT name, type, COALESCE(sql, '') FROM sqlite_master
             WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%'
             ORDER BY type, name",
        )
        .map_err(|e| SqliteError::QueryFailed(format!("读取表清单失败: {e}")))?;
    let out = stmt
        .query_map([], |r| {
            Ok(SqliteTable {
                name: r.get::<_, String>(0)?,
                kind: r.get::<_, String>(1)?,
                ddl: r.get::<_, String>(2)?,
            })
        })
        .map_err(|e| SqliteError::QueryFailed(format!("读取表清单失败: {e}")))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| SqliteError::QueryFailed(format!("读取表清单失败: {e}")))?;
    Ok(out)
}

/// 分页读行:LIMIT/OFFSET 可参数绑定;limit 钳 1..=500、offset 下限 0。
#[tauri::command]
pub fn sqlite_page(
    path: String,
    table: String,
    offset: Option<i64>,
    limit: Option<i64>,
) -> Result<SqlitePage, SqliteError> {
    let conn = open_readonly(&path)?;
    let q = quote_ident(&table)?;
    let offset = offset.unwrap_or(0).max(0);
    let limit = limit.unwrap_or(100).clamp(1, 500);

    let total: i64 = conn
        .query_row(&format!("SELECT COUNT(*) FROM {q}"), [], |r| r.get(0))
        .map_err(|e| SqliteError::QueryFailed(format!("统计行数失败: {e}")))?;

    let mut stmt = conn
        .prepare(&format!("SELECT * FROM {q} LIMIT ?1 OFFSET ?2"))
        .map_err(|e| SqliteError::QueryFailed(format!("查询失败: {e}")))?;
    // column_names 借用 stmt,先拷贝持有;Row 无 column_count,用 stmt 的
    let columns: Vec<String> = stmt.column_names().iter().map(|s| s.to_string()).collect();
    let ncols = stmt.column_count();
    let rows = stmt
        .query_map(params![limit, offset], |row| {
            (0..ncols)
                .map(|i| Ok(value_to_json(row.get_ref(i)?)))
                .collect::<Result<Vec<_>, _>>()
        })
        .map_err(|e| SqliteError::QueryFailed(format!("查询失败: {e}")))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| SqliteError::QueryFailed(format!("读取行数据失败: {e}")))?;
    Ok(SqlitePage { columns, rows, total })
}

/// 值 → JSON。三个坑:
/// - TEXT 可能非法 UTF-8 → from_utf8_lossy(get::<String> 会 Err);
/// - BLOB → 占位符(铁律 2:字节不走 IPC);
/// - REAL 可能 ±Inf → Value::from(f64) 自动把非有限值落 Null(from_f64().unwrap() 会 panic)。
fn value_to_json(v: ValueRef<'_>) -> serde_json::Value {
    match v {
        ValueRef::Null => serde_json::Value::Null,
        ValueRef::Integer(i) => serde_json::Value::from(i),
        ValueRef::Real(f) => serde_json::Value::from(f),
        ValueRef::Text(t) => {
            let s = String::from_utf8_lossy(t);
            // 超长文本截断(当前页 ≤500 行,护栏防单行巨文撑爆 IPC);
            // 按 4096 字节截须回退到字符边界,防切断多字节 UTF-8
            if s.len() > 4096 {
                let mut end = 4096;
                while end > 0 && !s.is_char_boundary(end) {
                    end -= 1;
                }
                serde_json::Value::String(format!("{}…(共 {} 字符,已截断)", &s[..end], s.chars().count()))
            } else {
                serde_json::Value::String(s.into_owned())
            }
        }
        ValueRef::Blob(b) => serde_json::Value::String(format!("[二进制 {} 字节]", b.len())),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> std::path::PathBuf {
        let p = std::env::temp_dir().join(format!("observer_sqlite_{}_{}", std::process::id(), name));
        let _ = std::fs::remove_file(&p);
        p
    }

    /// 造测试库:表 t(a INTEGER, b TEXT, c REAL, d BLOB)× N 行 + 视图 v。
    fn make_db(p: &Path, n: i64) {
        let conn = Connection::open(p).unwrap();
        conn.execute_batch(
            "CREATE TABLE t(a INTEGER PRIMARY KEY, b TEXT, c REAL, d BLOB);
             CREATE VIEW v AS SELECT a, b FROM t WHERE a < 100;",
        )
        .unwrap();
        for i in 0..n {
            conn.execute(
                "INSERT INTO t VALUES (?1, ?2, ?3, ?4)",
                rusqlite::params![
                    i,
                    format!("中文{}", i),
                    if i % 7 == 0 { f64::INFINITY } else { i as f64 / 2.0 },
                    vec![0x89u8, 0x50, 0x4E, 0x47, (i % 256) as u8],
                ],
            )
            .unwrap();
        }
    }

    #[test]
    fn tables_and_page_roundtrip() {
        let p = tmp("roundtrip.db");
        make_db(&p, 123);

        let tables = sqlite_tables(p.to_string_lossy().to_string()).unwrap();
        // 表在前、视图在后;sqlite_ 内部表被过滤
        assert_eq!(tables.len(), 2, "应只有 t 与 v:{tables:?}");
        assert_eq!((tables[0].name.as_str(), tables[0].kind.as_str()), ("t", "table"));
        assert_eq!((tables[1].name.as_str(), tables[1].kind.as_str()), ("v", "view"));
        assert!(tables[0].ddl.contains("CREATE TABLE"));

        // 全量 + 分页
        let page = sqlite_page(p.to_string_lossy().to_string(), "t".into(), Some(0), Some(100)).unwrap();
        assert_eq!(page.total, 123);
        assert_eq!(page.columns, vec!["a", "b", "c", "d"]);
        assert_eq!(page.rows.len(), 100);
        assert_eq!(page.rows[0][0], serde_json::json!(0));
        assert_eq!(page.rows[0][1], serde_json::json!("中文0"));
        assert_eq!(page.rows[0][2], serde_json::Value::Null, "Inf 应落 Null(i=0 行)");
        assert_eq!(page.rows[0][3], serde_json::json!("[二进制 5 字节]"));
        let page2 = sqlite_page(p.to_string_lossy().to_string(), "t".into(), Some(100), Some(100)).unwrap();
        assert_eq!(page2.rows.len(), 23);

        // 视图分页(COUNT 对视图同样生效)
        let vp = sqlite_page(p.to_string_lossy().to_string(), "v".into(), Some(0), None).unwrap();
        assert_eq!((vp.total, vp.columns.len()), (100, 2));

        // 表名含引号/特殊字符走 quote_ident 不炸
        conn_special_name(&p);
    }

    /// 引号表名回环:quote_ident 双写转义后可查询。
    fn conn_special_name(p: &Path) {
        let conn = Connection::open(p).unwrap();
        conn.execute_batch("CREATE TABLE \"we'ird \"\"name\" (x INTEGER); INSERT INTO \"we'ird \"\"name\" VALUES (42);")
            .unwrap();
        drop(conn);
        let page = sqlite_page(p.to_string_lossy().to_string(), "we'ird \"name".into(), Some(0), Some(10)).unwrap();
        assert_eq!(page.rows[0][0], serde_json::json!(42));
    }

    #[test]
    fn errors_not_sqlite_and_missing() {
        // 非 SQLite 文件 → NotSqlite(友好区分 LevelDB/LMDB 等)
        let p = tmp("fake.db");
        std::fs::write(&p, b"this is not a sqlite file at all").unwrap();
        match sqlite_tables(p.to_string_lossy().to_string()) {
            Err(SqliteError::NotSqlite(_)) => {}
            other => panic!("应返回 NotSqlite,实际 {other:?}"),
        }
        // 不存在 → NotFound
        match sqlite_tables(tmp("missing.db").to_string_lossy().to_string()) {
            Err(SqliteError::NotFound(_)) => {}
            other => panic!("应返回 NotFound,实际 {other:?}"),
        }
        // 合法库 + 不存在的表 → QueryFailed
        let good = tmp("good.db");
        make_db(&good, 3);
        assert!(matches!(
            sqlite_page(good.to_string_lossy().to_string(), "nope".into(), Some(0), None),
            Err(SqliteError::QueryFailed(_))
        ));
    }

    /// WAL 库:READ_ONLY 开不了(需可写 -shm)→ query_only 回退,且能读到 -wal 内新数据
    /// (证明没走 immutable 旧读)。写连接保持打开时拷贝三个文件,保留 -wal/-shm 现场。
    #[test]
    fn wal_db_falls_back_and_reads_wal() {
        let src = tmp("wal_src.db");
        let _ = std::fs::remove_file(src.with_extension("db-wal"));
        let _ = std::fs::remove_file(src.with_extension("db-shm"));
        let conn = Connection::open(&src).unwrap();
        conn.execute_batch(
            "PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0;
             CREATE TABLE t(a INTEGER);",
        )
        .unwrap();
        for i in 0..50 {
            conn.execute("INSERT INTO t VALUES (?1)", rusqlite::params![i]).unwrap();
        }
        // 拷贝现场(-shm 拷失败不致命:缺 -shm 同样逼出回退链)
        let dst = tmp("wal_copy.db");
        std::fs::copy(&src, &dst).unwrap();
        let _ = std::fs::copy(src.with_extension("db-wal"), dst.with_extension("db-wal"));
        let _ = std::fs::copy(src.with_extension("db-shm"), dst.with_extension("db-shm"));
        drop(conn);

        let page = sqlite_page(dst.to_string_lossy().to_string(), "t".into(), Some(0), Some(100)).unwrap();
        assert_eq!(page.total, 50, "应读到 -wal 内的 50 行(非 checkpoint 前旧数据)");
    }
}
