# Obverser — 设计理念

> 版本：v0.3（2026-08-29，拆分整理：框架选型/铁律/限制 → [framework.md](framework.md)，布局/功能 → [layout.md](layout.md)）
> 关联文档：[framework.md](framework.md)（框架选型与铁律限制）· [layout.md](layout.md)（布局与功能）· [method.md](method.md)（各格式的识别/预览/转换方法）
> 本文只讲"为什么这样设计"：产品定位、总体分层、数据持久化、转换预留与里程碑。

## 1. 产品定位

一个"预览尽可能多种类文件"的桌面应用：视频、音频、图片（含 RAW/HEIC/PSD）、3D 模型、动效文件（Lottie/Rive/SVGA）、字体、PDF 等。

- **现阶段**：只做预览，追求格式覆盖广度和打开速度
- **未来**：在同一架构上新增格式转换能力
- **首发平台**：Windows（主战场）+ macOS；Linux 暂缓（见 framework.md §6）；**明确放弃移动端**

形态参考：macOS Quick Look / Windows 开源 QuickLook / PowerToys Peek（空格键快速预览），但格式覆盖远超它们，且支持宫格多文件同时预览（见 layout.md）。

## 2. 总体架构

```
┌──────────────────────────── WebView 前端 ────────────────────────────┐
│  格式路由 UI 层：                                                      │
│   视频 <video> │ 音频 Web Audio+波形 │ 图片 <img>/canvas │            │
│   3D three.js/model-viewer │ Lottie lottie-web │ PDF pdf.js │ 文本   │
│  只消费：H.264+AAC MP4 流 / PNG·WebP 位图 / PCM / 结构化元数据        │
└───────▲──────────────────────────────────────────────▲──────────────┘
        │ stream:// 或 asset:// 协议（Range/206）        │ IPC / event（元数据·进度）
┌───────┴──────────────────────────────────────────────┴──────────────┐
│  Rust 后端（Tauri）                                                  │
│                                                                      │
│  ① 格式识别层：扩展名初筛 → 魔数嗅探（ftyp/JSON 字段/RIFF…）          │
│  ② 解码器注册表：handler.canHandle(file) → 预览策略（插件化，加格式    │
│     = 加一个 handler 文件）                                           │
│  ③ Job 引擎（预览与转换共用）：任务队列 + 进度 event + 取消句柄        │
│  ④ FFmpeg sidecar：ffprobe 探测 + remux/转码/截图子进程               │
│  ⑤ Rust 解码库：rawler/image/heic/psd/resvg/rustysynth…              │
│  ⑥ 缩略图管线：worker 池 + 磁盘缓存（key = 路径+mtime+size）          │
│  ⑦ 持久化层：SQLite（§3）                                             │
└──────────────────────────────────────────────────────────────────────┘
```

- 前后端边界由三条铁律划定（framework.md §2）：解码在 Rust、媒体字节不走 IPC、预览与转换共用管道
- 格式路由采用注册表模式：加一个格式 = 加一个 handler 文件 + registry 登记一行，不动架构

## 3. 数据持久化

### 3.1 持久化内容

| 数据 | 粒度 | 写入时机 | 恢复行为 |
|---|---|---|---|
| 当前打开的文件夹（含树展开状态） | 全局单例 | 变更时 | 启动时恢复（默认桌面） |
| 宫格布局 m×n、窗口/frame 尺寸 | 全局单例 | 变更时 | 启动时恢复 |
| 预览历史（打开过的文件及次数/时间） | 每文件一条 | 每次打开预览 | 供"记录管理"与最近列表使用 |
| 视频/音频播放位置 | 每文件一条 | 暂停时 + 播放中每 5s + 宫格关闭/应用退出时 | 再次打开自动续播（可 toast 提示"已从 mm:ss 继续"） |
| 文本/PDF 滚动位置（含页码、缩放） | 每文件一条 | 滚动停止 500ms 防抖 + 宫格关闭时 | 再次打开自动恢复滚动位置/页码/缩放 |
| 3D 视角（相机位置/目标点/焦距/朝向） | 每文件一条 | 交互停止 500ms 防抖 + 宫格关闭时 | 再次打开自动恢复视角 |

### 3.2 文件标识与失效处理

- **主键**：绝对路径；**校验**：记录同时保存 mtime + size
- mtime/size 不匹配 → 文件已被修改：位置类记录（播放/滚动/视角）**重置**，历史记录保留并更新元信息
- 路径不存在 → 记录标记 `missing`，记录管理界面中灰显，可一键"清理失效记录"

### 3.3 存储方案：SQLite（rusqlite）

单文件数据库，存于应用数据目录（`app_data_dir`，Windows 为 `%APPDATA%/<app>/obverser.db`）。

**为什么不用 JSON 配置文件**：播放位置每 5 秒一次小写入，JSON 全量重写既慢又在崩溃时易整体损坏；SQLite 单条 `UPDATE` 原子完成，抗崩、可按条件查询/删除（记录管理需要）。

```sql
-- 全局单例状态（当前文件夹、展开状态、宫格布局、窗口尺寸…）
app_state(key TEXT PRIMARY KEY, value TEXT NOT NULL);

-- 预览历史
preview_history(
  path TEXT PRIMARY KEY,
  size INTEGER, mtime INTEGER,
  open_count INTEGER NOT NULL DEFAULT 1,
  first_opened INTEGER NOT NULL,
  last_opened INTEGER NOT NULL,
  missing INTEGER NOT NULL DEFAULT 0
);

-- 视频/音频播放位置（秒）
media_position(
  path TEXT PRIMARY KEY,
  position REAL NOT NULL,
  duration REAL,
  updated_at INTEGER NOT NULL
);

-- 文本/PDF 位置（页码 + 滚动偏移 + 缩放）
doc_position(
  path TEXT PRIMARY KEY,
  page INTEGER, scroll_x REAL, scroll_y REAL, zoom REAL,
  updated_at INTEGER NOT NULL
);

-- 3D 视角（相机参数 JSON）
threed_camera(
  path TEXT PRIMARY KEY,
  camera TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
```

### 3.4 可选择性删除（记录管理）

- 入口：顶部栏设置 → **记录管理**（layout.md §2）
- 界面按类型分组列出全部记录（预览历史 / 播放位置 / 文档位置 / 3D 视角），支持：
  - 单条删除、勾选多条删除
  - 按类型清空、全部清空
  - 一键清理失效（文件已不存在）记录
- **保留策略**（设置项）：条数上限（默认 500，超出淘汰最旧）或按保留天数（默认不限）
- 全部数据仅存本地，不上传不同步；删除 db 文件即恢复出厂状态

## 4. 未来格式转换的架构预留

预览与转换共用 Job 引擎，概念骨架：

```rust
enum Job {
    Preview { input: PathBuf, target: PreviewTarget },              // 流式、低码率
    Convert { input: PathBuf, output: PathBuf, format: Format, opts: ConvertOpts },
}
// + 任务队列 / 进度 event 推前端 / 取消句柄
```

"新增转换格式" = 往注册表加一条模板，不动架构。各格式的具体转换方法见 method.md §8。

## 5. 里程碑

1. **M1 架构验证**：Tauri 2 + ffmpeg-sidecar，打通视频四级预览管道（最难、最能验证架构）+ stream:// 协议 Range/seek
2. **M2 图片 + 持久化基础设施**：格式识别层 + 解码器注册表 + 缩略图缓存 + SQLite 持久化层（§3，文件夹/历史先行）
3. **M3 音频**：FFmpeg 音频流 + 波形 + MIDI；播放位置持久化接线
4. **M4 3D/动效/文档**：three.js、lottie-web、pdf.js（最简单，纯前端）；视角/滚动位置持久化接线
5. **M5 转换功能**：Job 引擎加 Convert 出口 + FFmpeg 命令模板库
