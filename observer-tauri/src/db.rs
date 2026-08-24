//! SQLite 持久化层(rusqlite)— design.md §9。
//!
//! 单文件数据库,存于应用数据目录(Windows:`%APPDATA%/com.observer.app/observer.db`)。
//! 选 SQLite 而非 JSON 配置:播放位置每 5 秒一次小写入,JSON 全量重写既慢又易在崩溃时整体
//! 损坏;SQLite 单条 `UPDATE` 原子完成,抗崩、可按条件查询/删除(记录管理需要)。
//!
//! 文件标识与失效(§9.2):主键 = 绝对路径;preview_history 同时保存 mtime + size 校验。
//! 路径不存在 → history_open 记 missing=1(记录管理界面据此灰显,随 M2 完整版提供)。
//!
//! 结构:核心逻辑为接受 `&Connection` 的自由函数(可单测),`#[tauri::command]` 仅是
//! `State<Db>` 加锁后的薄封装。

use rusqlite::{params, Connection};
use serde::Serialize;
use std::fs;
use std::path::Path;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::State;

/// 全局单例:Tauri managed state(Mutex 保证多命令串行访问,本场景无争用性能问题)。
pub struct Db(pub Mutex<Connection>);

fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

fn mtime_secs(meta: &fs::Metadata) -> i64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// 打开(必要时创建)数据库并建表。path 为 observer.db 的完整路径。
pub fn init(path: &Path) -> Result<Db, String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建数据目录失败: {e}"))?;
    }
    let conn = Connection::open(path).map_err(|e| format!("打开数据库失败: {e}"))?;
    conn.execute_batch(
        "
        PRAGMA journal_mode=WAL;

        -- 全局单例状态(当前文件夹、宫格布局/选中、窗口尺寸…)
        CREATE TABLE IF NOT EXISTS app_state(
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );

        -- 预览历史(每文件一条)
        CREATE TABLE IF NOT EXISTS preview_history(
          path TEXT PRIMARY KEY,
          size INTEGER,
          mtime INTEGER,
          open_count INTEGER NOT NULL DEFAULT 1,
          first_opened INTEGER NOT NULL,
          last_opened INTEGER NOT NULL,
          missing INTEGER NOT NULL DEFAULT 0
        );

        -- 视频/音频播放位置(秒)+ 音量/倍速(第二批:音量/倍速持久化)
        CREATE TABLE IF NOT EXISTS media_position(
          path TEXT PRIMARY KEY,
          position REAL NOT NULL,
          duration REAL,
          volume REAL,
          rate REAL,
          updated_at INTEGER NOT NULL
        );

        -- 文本/PDF 位置(页码 + 滚动偏移 + 缩放);图片平移/缩放也复用此表
        CREATE TABLE IF NOT EXISTS doc_position(
          path TEXT PRIMARY KEY,
          page INTEGER,
          scroll_x REAL,
          scroll_y REAL,
          zoom REAL,
          updated_at INTEGER NOT NULL
        );

        -- 3D 视角(相机参数 JSON)— M4 使用,先建表
        CREATE TABLE IF NOT EXISTS threed_camera(
          path TEXT PRIMARY KEY,
          camera TEXT NOT NULL,
          updated_at INTEGER NOT NULL
        );
        ",
    )
    .map_err(|e| format!("建表失败: {e}"))?;
    // 旧库迁移:为已有 media_position 补 volume/rate 列(第二批功能新增)。
    ensure_column(&conn, "media_position", "volume", "REAL")?;
    ensure_column(&conn, "media_position", "rate", "REAL")?;
    Ok(Db(Mutex::new(conn)))
}

/// 为已存在的旧库补列(ALTER TABLE 无 IF NOT EXISTS,先查 table_info 再决定是否 ALTER)。
fn ensure_column(conn: &Connection, table: &str, column: &str, decl: &str) -> Result<(), String> {
    let mut stmt = conn
        .prepare(&format!("PRAGMA table_info({table})"))
        .map_err(|e| e.to_string())?;
    let names = stmt
        .query_map([], |r| r.get::<_, String>(1))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    if !names.iter().any(|n| n == column) {
        conn.execute(&format!("ALTER TABLE {table} ADD COLUMN {column} {decl}"), [])
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

// ---- 核心逻辑(&Connection,可单测) ----

fn state_get(conn: &Connection, key: &str) -> Result<Option<String>, String> {
    let mut stmt = conn
        .prepare("SELECT value FROM app_state WHERE key = ?1")
        .map_err(|e| e.to_string())?;
    let mut rows = stmt.query(params![key]).map_err(|e| e.to_string())?;
    match rows.next().map_err(|e| e.to_string())? {
        Some(r) => Ok(Some(r.get(0).map_err(|e| e.to_string())?)),
        None => Ok(None),
    }
}

fn state_set(conn: &Connection, key: &str, value: &str) -> Result<(), String> {
    conn.execute(
        "INSERT INTO app_state(key, value) VALUES(?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[derive(Serialize, Debug, PartialEq)]
pub struct HistoryRow {
    pub path: String,
    pub size: i64,
    pub mtime: i64,
    pub open_count: i64,
    pub first_opened: i64,
    pub last_opened: i64,
    pub missing: bool,
}

fn history_open_conn(conn: &Connection, path: &str) -> Result<(), String> {
    let (size, mtime, missing) = match fs::metadata(path) {
        Ok(m) => (m.len() as i64, mtime_secs(&m), 0),
        Err(_) => (0, 0, 1),
    };
    // §9.2 失效接线:文件被修改(mtime/size 与记录不符)→ 位置类记录(播放/滚动)重置,历史保留并更新元信息。
    if missing == 0 {
        if let Some((old_size, old_mtime)) = existing_size_mtime(conn, path)? {
            if old_size != size || old_mtime != mtime {
                let _ = conn.execute("DELETE FROM media_position WHERE path = ?1", params![path]);
                let _ = conn.execute("DELETE FROM doc_position WHERE path = ?1", params![path]);
            }
        }
    }
    let t = now();
    conn.execute(
        "INSERT INTO preview_history(path, size, mtime, open_count, first_opened, last_opened, missing)
         VALUES(?1, ?2, ?3, 1, ?4, ?4, ?5)
         ON CONFLICT(path) DO UPDATE SET
           size = excluded.size,
           mtime = excluded.mtime,
           open_count = open_count + 1,
           last_opened = excluded.last_opened,
           missing = excluded.missing",
        params![path, size, mtime, t, missing],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// 读取某路径已记录的 size/mtime(供失效比对)。无记录返回 None。
fn existing_size_mtime(conn: &Connection, path: &str) -> Result<Option<(i64, i64)>, String> {
    let mut stmt = conn
        .prepare("SELECT size, mtime FROM preview_history WHERE path = ?1")
        .map_err(|e| e.to_string())?;
    let mut rows = stmt.query(params![path]).map_err(|e| e.to_string())?;
    match rows.next().map_err(|e| e.to_string())? {
        Some(r) => Ok(Some((
            r.get(0).map_err(|e| e.to_string())?,
            r.get(1).map_err(|e| e.to_string())?,
        ))),
        None => Ok(None),
    }
}

fn history_list_conn(conn: &Connection) -> Result<Vec<HistoryRow>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT path, size, mtime, open_count, first_opened, last_opened, missing
             FROM preview_history ORDER BY last_opened DESC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok(HistoryRow {
                path: r.get(0)?,
                size: r.get(1)?,
                mtime: r.get(2)?,
                open_count: r.get(3)?,
                first_opened: r.get(4)?,
                last_opened: r.get(5)?,
                missing: r.get::<_, i64>(6)? != 0,
            })
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

#[derive(Serialize, Debug, PartialEq)]
pub struct MediaPos {
    pub position: f64,
    pub duration: Option<f64>,
    pub volume: Option<f64>,
    pub rate: Option<f64>,
}

fn media_pos_get_conn(conn: &Connection, path: &str) -> Result<Option<MediaPos>, String> {
    let mut stmt = conn
        .prepare("SELECT position, duration, volume, rate FROM media_position WHERE path = ?1")
        .map_err(|e| e.to_string())?;
    let mut rows = stmt.query(params![path]).map_err(|e| e.to_string())?;
    match rows.next().map_err(|e| e.to_string())? {
        Some(r) => Ok(Some(MediaPos {
            position: r.get(0).map_err(|e| e.to_string())?,
            duration: r.get(1).map_err(|e| e.to_string())?,
            volume: r.get(2).map_err(|e| e.to_string())?,
            rate: r.get(3).map_err(|e| e.to_string())?,
        })),
        None => Ok(None),
    }
}

fn media_pos_set_conn(
    conn: &Connection,
    path: &str,
    position: f64,
    duration: Option<f64>,
    volume: Option<f64>,
    rate: Option<f64>,
) -> Result<(), String> {
    conn.execute(
        "INSERT INTO media_position(path, position, duration, volume, rate, updated_at) VALUES(?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(path) DO UPDATE SET
           position = excluded.position, duration = excluded.duration,
           volume = excluded.volume, rate = excluded.rate, updated_at = excluded.updated_at",
        params![path, position, duration, volume, rate, now()],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[derive(Serialize, Debug, PartialEq)]
pub struct DocPos {
    pub page: Option<i64>,
    pub scroll_x: Option<f64>,
    pub scroll_y: Option<f64>,
    pub zoom: Option<f64>,
}

fn doc_pos_get_conn(conn: &Connection, path: &str) -> Result<Option<DocPos>, String> {
    let mut stmt = conn
        .prepare("SELECT page, scroll_x, scroll_y, zoom FROM doc_position WHERE path = ?1")
        .map_err(|e| e.to_string())?;
    let mut rows = stmt.query(params![path]).map_err(|e| e.to_string())?;
    match rows.next().map_err(|e| e.to_string())? {
        Some(r) => Ok(Some(DocPos {
            page: r.get(0).map_err(|e| e.to_string())?,
            scroll_x: r.get(1).map_err(|e| e.to_string())?,
            scroll_y: r.get(2).map_err(|e| e.to_string())?,
            zoom: r.get(3).map_err(|e| e.to_string())?,
        })),
        None => Ok(None),
    }
}

fn doc_pos_set_conn(
    conn: &Connection,
    path: &str,
    page: Option<i64>,
    scroll_x: Option<f64>,
    scroll_y: Option<f64>,
    zoom: Option<f64>,
) -> Result<(), String> {
    conn.execute(
        "INSERT INTO doc_position(path, page, scroll_x, scroll_y, zoom, updated_at)
         VALUES(?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(path) DO UPDATE SET
           page = excluded.page, scroll_x = excluded.scroll_x, scroll_y = excluded.scroll_y,
           zoom = excluded.zoom, updated_at = excluded.updated_at",
        params![path, page, scroll_x, scroll_y, zoom, now()],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

// ---- 记录管理(design.md §9.4):各类记录的 list / remove / clear / 清理失效 / 保留策略 ----

#[derive(Serialize, Debug, PartialEq)]
pub struct MediaPosRow {
    pub path: String,
    pub position: f64,
    pub duration: Option<f64>,
    pub volume: Option<f64>,
    pub rate: Option<f64>,
    pub updated_at: i64,
}

#[derive(Serialize, Debug, PartialEq)]
pub struct DocPosRow {
    pub path: String,
    pub page: Option<i64>,
    pub scroll_x: Option<f64>,
    pub scroll_y: Option<f64>,
    pub zoom: Option<f64>,
    pub updated_at: i64,
}

#[derive(Serialize, Debug, PartialEq)]
pub struct ThreeDRow {
    pub path: String,
    pub camera: String,
    pub updated_at: i64,
}

fn media_pos_list_conn(conn: &Connection) -> Result<Vec<MediaPosRow>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT path, position, duration, volume, rate, updated_at
             FROM media_position ORDER BY updated_at DESC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok(MediaPosRow {
                path: r.get(0)?,
                position: r.get(1)?,
                duration: r.get(2)?,
                volume: r.get(3)?,
                rate: r.get(4)?,
                updated_at: r.get(5)?,
            })
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

fn doc_pos_list_conn(conn: &Connection) -> Result<Vec<DocPosRow>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT path, page, scroll_x, scroll_y, zoom, updated_at
             FROM doc_position ORDER BY updated_at DESC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok(DocPosRow {
                path: r.get(0)?,
                page: r.get(1)?,
                scroll_x: r.get(2)?,
                scroll_y: r.get(3)?,
                zoom: r.get(4)?,
                updated_at: r.get(5)?,
            })
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

fn threed_get_conn(conn: &Connection, path: &str) -> Result<Option<String>, String> {
    let mut stmt = conn
        .prepare("SELECT camera FROM threed_camera WHERE path = ?1")
        .map_err(|e| e.to_string())?;
    let mut rows = stmt.query(params![path]).map_err(|e| e.to_string())?;
    match rows.next().map_err(|e| e.to_string())? {
        Some(r) => Ok(Some(r.get(0).map_err(|e| e.to_string())?)),
        None => Ok(None),
    }
}

fn threed_set_conn(conn: &Connection, path: &str, camera: &str) -> Result<(), String> {
    conn.execute(
        "INSERT INTO threed_camera(path, camera, updated_at) VALUES(?1, ?2, ?3)
         ON CONFLICT(path) DO UPDATE SET camera = excluded.camera, updated_at = excluded.updated_at",
        params![path, camera, now()],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn threed_list_conn(conn: &Connection) -> Result<Vec<ThreeDRow>, String> {
    let mut stmt = conn
        .prepare("SELECT path, camera, updated_at FROM threed_camera ORDER BY updated_at DESC")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok(ThreeDRow {
                path: r.get(0)?,
                camera: r.get(1)?,
                updated_at: r.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

/// 删除某表中指定路径的记录(记录管理单条/勾选删除用)。table 须为白名单内表名。
fn remove_by_path(conn: &Connection, table: &str, path: &str) -> Result<(), String> {
    // table 来自固定调用点(不接收前端任意输入),仅用白名单校验防注入。
    let t = match table {
        "preview_history" | "media_position" | "doc_position" | "threed_camera" => table,
        _ => return Err(format!("非法表名: {table}")),
    };
    conn.execute(&format!("DELETE FROM {t} WHERE path = ?1"), params![path])
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// 清空某表(记录管理"按类型清空"用)。
fn clear_table(conn: &Connection, table: &str) -> Result<(), String> {
    let t = match table {
        "preview_history" | "media_position" | "doc_position" | "threed_camera" => table,
        _ => return Err(format!("非法表名: {table}")),
    };
    conn.execute(&format!("DELETE FROM {t}"), [])
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// 一键清理失效历史(文件已不存在)。返回删除条数。
fn history_purge_missing_conn(conn: &Connection) -> Result<usize, String> {
    let n = conn
        .execute("DELETE FROM preview_history WHERE missing != 0", [])
        .map_err(|e| e.to_string())?;
    Ok(n)
}

/// 保留策略:仅保留最近打开的 limit 条历史,超出淘汰最旧。返回删除条数。
fn history_apply_retention_conn(conn: &Connection, limit: i64) -> Result<usize, String> {
    let n = conn
        .execute(
            "DELETE FROM preview_history WHERE path NOT IN (
               SELECT path FROM preview_history ORDER BY last_opened DESC LIMIT ?1
             )",
            params![limit],
        )
        .map_err(|e| e.to_string())?;
    Ok(n)
}

// ---- Tauri 命令(薄封装:State 加锁 → 核心逻辑) ----

#[tauri::command]
pub fn app_state_get(db: State<Db>, key: String) -> Result<Option<String>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    state_get(&conn, &key)
}
#[tauri::command]
pub fn app_state_set(db: State<Db>, key: String, value: String) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    state_set(&conn, &key, &value)
}
#[tauri::command]
pub fn history_open(db: State<Db>, path: String) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    history_open_conn(&conn, &path)
}
#[tauri::command]
pub fn history_list(db: State<Db>) -> Result<Vec<HistoryRow>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    history_list_conn(&conn)
}
#[tauri::command]
pub fn history_remove(db: State<Db>, path: String) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM preview_history WHERE path = ?1", params![path])
        .map_err(|e| e.to_string())?;
    Ok(())
}
#[tauri::command]
pub fn history_clear(db: State<Db>) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM preview_history", [])
        .map_err(|e| e.to_string())?;
    Ok(())
}
#[tauri::command]
pub fn media_pos_get(db: State<Db>, path: String) -> Result<Option<MediaPos>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    media_pos_get_conn(&conn, &path)
}
#[tauri::command]
pub fn media_pos_set(
    db: State<Db>,
    path: String,
    position: f64,
    duration: Option<f64>,
    volume: Option<f64>,
    rate: Option<f64>,
) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    media_pos_set_conn(&conn, &path, position, duration, volume, rate)
}
#[tauri::command]
pub fn doc_pos_get(db: State<Db>, path: String) -> Result<Option<DocPos>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    doc_pos_get_conn(&conn, &path)
}
#[tauri::command]
pub fn doc_pos_set(
    db: State<Db>,
    path: String,
    page: Option<i64>,
    scroll_x: Option<f64>,
    scroll_y: Option<f64>,
    zoom: Option<f64>,
) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    doc_pos_set_conn(&conn, &path, page, scroll_x, scroll_y, zoom)
}

// ---- 记录管理命令(design.md §9.4) ----

#[tauri::command]
pub fn media_pos_list(db: State<Db>) -> Result<Vec<MediaPosRow>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    media_pos_list_conn(&conn)
}
#[tauri::command]
pub fn media_pos_remove(db: State<Db>, path: String) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    remove_by_path(&conn, "media_position", &path)
}
#[tauri::command]
pub fn media_pos_clear(db: State<Db>) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    clear_table(&conn, "media_position")
}
#[tauri::command]
pub fn doc_pos_list(db: State<Db>) -> Result<Vec<DocPosRow>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    doc_pos_list_conn(&conn)
}
#[tauri::command]
pub fn doc_pos_remove(db: State<Db>, path: String) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    remove_by_path(&conn, "doc_position", &path)
}
#[tauri::command]
pub fn doc_pos_clear(db: State<Db>) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    clear_table(&conn, "doc_position")
}
#[tauri::command]
pub fn threed_get(db: State<Db>, path: String) -> Result<Option<String>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    threed_get_conn(&conn, &path)
}
#[tauri::command]
pub fn threed_set(db: State<Db>, path: String, camera: String) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    threed_set_conn(&conn, &path, &camera)
}
#[tauri::command]
pub fn threed_list(db: State<Db>) -> Result<Vec<ThreeDRow>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    threed_list_conn(&conn)
}
#[tauri::command]
pub fn threed_remove(db: State<Db>, path: String) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    remove_by_path(&conn, "threed_camera", &path)
}
#[tauri::command]
pub fn threed_clear(db: State<Db>) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    clear_table(&conn, "threed_camera")
}
#[tauri::command]
pub fn history_purge_missing(db: State<Db>) -> Result<usize, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    history_purge_missing_conn(&conn)
}
#[tauri::command]
pub fn history_apply_retention(db: State<Db>, limit: i64) -> Result<usize, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    history_apply_retention_conn(&conn, limit)
}

// ---- 测试 ----

#[cfg(test)]
mod tests {
    use super::*;

    /// 每个测试用独立库文件(并行测试不互相污染),返回 (连接, 库路径)。
    fn temp_conn() -> (Connection, String) {
        use std::sync::atomic::{AtomicU64, Ordering};
        static COUNTER: AtomicU64 = AtomicU64::new(0);
        let n = COUNTER.fetch_add(1, Ordering::SeqCst);
        let path = std::env::temp_dir().join(format!(
            "observer_dbtest_{}_{}.db",
            std::process::id(),
            n
        ));
        let _ = fs::remove_file(&path);
        // init 返回 Db,这里直接取内部连接做测试
        let db = init(&path).expect("init db");
        (db.0.into_inner().expect("into_inner"), path.to_string_lossy().to_string())
    }

    #[test]
    fn app_state_roundtrip() {
        let (conn, _) = temp_conn();
        assert_eq!(state_get(&conn, "grid").unwrap(), None);
        state_set(&conn, "grid", "{\"cols\":2}").unwrap();
        assert_eq!(state_get(&conn, "grid").unwrap(), Some("{\"cols\":2}".into()));
        state_set(&conn, "grid", "{\"cols\":3}").unwrap(); // upsert 覆盖
        assert_eq!(state_get(&conn, "grid").unwrap(), Some("{\"cols\":3}".into()));
    }

    #[test]
    fn history_upsert_counts_and_missing() {
        let (conn, real) = temp_conn();
        // 存在的文件(本测试 db 文件即可) → missing=0;不存在 → missing=1
        history_open_conn(&conn, &real).unwrap();
        history_open_conn(&conn, &real).unwrap();
        history_open_conn(&conn, "C:/no/such/file_xyz.mp4").unwrap();

        let rows = history_list_conn(&conn).unwrap();
        assert_eq!(rows.len(), 2);
        let real_row = rows.iter().find(|r| r.path == real).unwrap();
        assert_eq!(real_row.open_count, 2); // 两次打开自增
        assert!(!real_row.missing);
        let miss_row = rows.iter().find(|r| r.path.contains("file_xyz")).unwrap();
        assert!(miss_row.missing);
    }

    #[test]
    fn media_and_doc_positions_roundtrip() {
        let (conn, _) = temp_conn();
        assert_eq!(media_pos_get_conn(&conn, "a.mp4").unwrap(), None);
        media_pos_set_conn(&conn, "a.mp4", 12.5, Some(100.0), Some(0.8), Some(1.5)).unwrap();
        assert_eq!(
            media_pos_get_conn(&conn, "a.mp4").unwrap(),
            Some(MediaPos { position: 12.5, duration: Some(100.0), volume: Some(0.8), rate: Some(1.5) })
        );
        media_pos_set_conn(&conn, "a.mp4", 30.0, Some(100.0), None, None).unwrap(); // 覆盖
        let m = media_pos_get_conn(&conn, "a.mp4").unwrap().unwrap();
        assert_eq!(m.position, 30.0);
        assert_eq!(m.volume, None); // 音量/倍速可被覆盖为 NULL
        assert_eq!(m.rate, None);

        assert_eq!(doc_pos_get_conn(&conn, "b.txt").unwrap(), None);
        doc_pos_set_conn(&conn, "b.txt", None, Some(0.0), Some(240.0), Some(16.0)).unwrap();
        let d = doc_pos_get_conn(&conn, "b.txt").unwrap().unwrap();
        assert_eq!(d.scroll_y, Some(240.0));
        assert_eq!(d.zoom, Some(16.0));
    }

    #[test]
    fn record_management_lists_and_clears() {
        let (conn, _) = temp_conn();
        media_pos_set_conn(&conn, "a.mp4", 1.0, Some(10.0), None, None).unwrap();
        media_pos_set_conn(&conn, "b.mp4", 2.0, Some(20.0), None, None).unwrap();
        doc_pos_set_conn(&conn, "c.txt", Some(3), None, None, None).unwrap();
        threed_set_conn(&conn, "d.glb", "{\"pos\":[0,0,1]}").unwrap();

        assert_eq!(media_pos_list_conn(&conn).unwrap().len(), 2);
        assert_eq!(doc_pos_list_conn(&conn).unwrap().len(), 1);
        let three = threed_list_conn(&conn).unwrap();
        assert_eq!(three.len(), 1);
        assert_eq!(threed_get_conn(&conn, "d.glb").unwrap(), Some("{\"pos\":[0,0,1]}".into()));

        remove_by_path(&conn, "media_position", "a.mp4").unwrap();
        assert_eq!(media_pos_list_conn(&conn).unwrap().len(), 1);
        clear_table(&conn, "doc_position").unwrap();
        assert!(doc_pos_list_conn(&conn).unwrap().is_empty());
        clear_table(&conn, "threed_camera").unwrap();
        assert!(threed_list_conn(&conn).unwrap().is_empty());

        // 非法表名被拒(防注入)
        assert!(remove_by_path(&conn, "sqlite_master", "x").is_err());
        assert!(clear_table(&conn, "app_state; DROP TABLE app_state").is_err());
    }

    #[test]
    fn history_purge_missing_and_retention() {
        let (conn, real) = temp_conn();
        history_open_conn(&conn, &real).unwrap(); // 存在 → missing=0
        history_open_conn(&conn, "C:/no/such/a.mp4").unwrap(); // missing=1
        history_open_conn(&conn, "C:/no/such/b.mp4").unwrap(); // missing=1
        assert_eq!(history_list_conn(&conn).unwrap().len(), 3);

        // 清理失效:删掉 2 条 missing
        assert_eq!(history_purge_missing_conn(&conn).unwrap(), 2);
        let rows = history_list_conn(&conn).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].path, real);

        // 保留策略:构造 5 条,保留 2 条
        for i in 0..5 {
            history_open_conn(&conn, &format!("C:/no/such/r{i}.mp4")).unwrap();
        }
        let before = history_list_conn(&conn).unwrap().len();
        let removed = history_apply_retention_conn(&conn, 2).unwrap();
        let after = history_list_conn(&conn).unwrap();
        assert_eq!(after.len(), 2);
        assert_eq!(removed, before - 2);
    }

    #[test]
    fn history_open_resets_positions_on_content_change() {
        let (conn, _) = temp_conn();
        // 造一个真实文件,先记历史 + 播放/滚动位置
        let f = std::env::temp_dir().join(format!("observer_inv_{}.txt", std::process::id()));
        std::fs::write(&f, b"v1").unwrap();
        let p = f.to_string_lossy().to_string();
        history_open_conn(&conn, &p).unwrap();
        media_pos_set_conn(&conn, &p, 5.0, Some(10.0), None, None).unwrap();
        doc_pos_set_conn(&conn, &p, None, None, Some(99.0), None).unwrap();

        // 修改文件内容(mtime/size 变化)→ 再次 open 应重置位置类记录
        std::thread::sleep(std::time::Duration::from_millis(1100)); // 确保 mtime 秒数变化
        std::fs::write(&f, b"v2-longer-content").unwrap();
        history_open_conn(&conn, &p).unwrap();

        assert!(media_pos_get_conn(&conn, &p).unwrap().is_none(), "内容变化应重置播放位置");
        assert!(doc_pos_get_conn(&conn, &p).unwrap().is_none(), "内容变化应重置滚动位置");
        // 历史本身保留并更新
        assert_eq!(history_list_conn(&conn).unwrap().iter().find(|r| r.path == p).unwrap().open_count, 2);
        let _ = std::fs::remove_file(&f);
    }
}
