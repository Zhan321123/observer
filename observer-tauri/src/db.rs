//! TODO(M2): SQLite 持久化层(rusqlite)— design.md §9。
//!
//! 本文件是 M2 的占位/蓝图,**尚未纳入模块树**(lib.rs 未声明 `mod db;`),`cargo` 暂不编译它。
//! 实现时在 lib.rs 加 `mod db;`、`Cargo.toml` 加 `rusqlite = { version = "0.3x", features = ["bundled"] }`,
//! 并在 `run()` 的 setup 里打开数据库、建表。
//!
//! ## 为什么用 SQLite 而不是 JSON 配置(design.md §9.3)
//! 播放位置每 5 秒一次小写入,JSON 全量重写既慢又易在崩溃时整体损坏;SQLite 单条 UPDATE
//! 原子完成,抗崩、可按条件查询/删除(记录管理需要)。
//!
//! ## 存储位置
//! 单文件数据库,存于应用数据目录:`app_data_dir`(Windows 为 `%APPDATA%/com.observer.app/observer.db`)。
//!
//! ## 文件标识与失效(design.md §9.2)
//! - 主键 = 绝对路径;同时保存 mtime + size 校验。
//! - mtime/size 不匹配 → 文件已改:位置类记录(播放/滚动/视角)重置,历史保留并更新元信息。
//! - 路径不存在 → 标记 `missing`,记录管理中灰显,可一键清理。
//!
//! ## 表结构(design.md §9.3)
//!
//! ```sql
//! -- 全局单例状态(当前文件夹、展开状态、宫格布局、窗口尺寸…)
//! CREATE TABLE IF NOT EXISTS app_state(key TEXT PRIMARY KEY, value TEXT NOT NULL);
//!
//! -- 预览历史
//! CREATE TABLE IF NOT EXISTS preview_history(
//!   path TEXT PRIMARY KEY,
//!   size INTEGER, mtime INTEGER,
//!   open_count INTEGER NOT NULL DEFAULT 1,
//!   first_opened INTEGER NOT NULL,
//!   last_opened INTEGER NOT NULL,
//!   missing INTEGER NOT NULL DEFAULT 0
//! );
//!
//! -- 视频/音频播放位置(秒)
//! CREATE TABLE IF NOT EXISTS media_position(
//!   path TEXT PRIMARY KEY,
//!   position REAL NOT NULL,
//!   duration REAL,
//!   updated_at INTEGER NOT NULL
//! );
//!
//! -- 文本/PDF 位置(页码 + 滚动偏移 + 缩放)
//! CREATE TABLE IF NOT EXISTS doc_position(
//!   path TEXT PRIMARY KEY,
//!   page INTEGER, scroll_x REAL, scroll_y REAL, zoom REAL,
//!   updated_at INTEGER NOT NULL
//! );
//!
//! -- 3D 视角(相机参数 JSON)
//! CREATE TABLE IF NOT EXISTS threed_camera(
//!   path TEXT PRIMARY KEY,
//!   camera TEXT NOT NULL,
//!   updated_at INTEGER NOT NULL
//! );
//! ```
//!
//! ## 记录管理(design.md §9.4)
//! 入口:顶部栏设置 → 记录管理。按类型分组列出全部记录,支持单条/勾选删除、按类型清空、
//! 全部清空、一键清理失效。保留策略:条数上限(默认 500,超出淘汰最旧)或按保留天数(默认不限)。
//! 全部数据仅存本地,不上传不同步;删除 db 文件即恢复出厂状态。
