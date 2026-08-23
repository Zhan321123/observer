# Obverser — 技术架构设计

> 版本：v0.2（2026-08-22）
> 状态：架构设计定稿，待搭脚手架
> 关联文档：[layout.md](layout.md)（界面与交互）· [method.md](method.md)（各格式的识别/预览/转换方法）

## 1. 产品定位

一个"预览尽可能多种类文件"的桌面应用：视频、音频、图片（含 RAW/HEIC/PSD）、3D 模型、动效文件（Lottie/Rive/SVGA）、字体、PDF 等。

- **现阶段**：只做预览，追求格式覆盖广度和打开速度
- **未来**：在同一架构上新增格式转换能力
- **首发平台**：Windows（主战场）+ macOS；Linux 暂缓（见 §4）；**明确放弃移动端**

形态参考：macOS Quick Look / Windows 开源 QuickLook / PowerToys Peek（空格键快速预览），但格式覆盖远超它们，且支持宫格多文件同时预览（见 layout.md）。

## 2. 技术选型

**Tauri 2（Rust 后端）+ 系统 WebView 前端**

| 对比项 | Tauri/Rust（选用） | Electron/Node |
|---|---|---|
| 包体 | ~15MB 壳 + FFmpeg ≈ 60-100MB | ~250MB+ |
| 内存/启动 | 优 | 一般 |
| 格式覆盖上限 | 相同（都由 FFmpeg 决定） | 相同 |
| 3D 预览 | 相同（都是 WebGL） | 相同 |
| 格式转换（未来） | Rust 直接调 FFmpeg/原生解码库，顺 | child_process + node-addon，绕 |
| 全平台渲染一致性 | WebView 内核不一（风险，见 §4） | 全平台 Chromium，一致 |
| 开发速度/生态 | Rust 媒体生态 2025 已补齐 | npm 现成包更多，开发更快 |

## 3. 架构铁律（三条）

1. **解码永远发生在 Rust 侧**（FFmpeg sidecar + Rust crates），WebView 只消费"安全格式"：H.264(baseline)+AAC 的 MP4 流、PNG/WebP 位图、PCM 音频。
2. **媒体字节流走 protocol / localhost HTTP，不走 IPC**。实测二进制走 `invoke` IPC 阻塞 WebView 主线程 ~48ms（卡顿），走自定义 protocol 为 0ms。IPC/event 只传元数据、缩略图、进度事件。大文件因此与 C++ 原生播放器同为"看一段读一段"：Range 请求 → seek+read 分块，内存占用与文件大小无关，10GB 文件秒开。
3. **预览与转换共用一个 Job 引擎**。预览 = 解码 → 编码为 Web 安全格式（实时流）；转换 = 解码 → 编码为用户指定格式（写文件）。同一条管道，两个出口。

## 4. 关键风险与对策

### 4.1 WebView 三内核编解码差异（Tauri 相对 Electron 唯一短板）

| 平台 | 内核 | 能力 | 评价 |
|---|---|---|---|
| Windows | WebView2（Chromium） | H.264/AAC/MP3/VP9/AV1；HEVC 需系统装商店扩展（约 ¥7，OEM 机常预装） | 很好 |
| macOS | WKWebView（Safari） | H.264/HEVC/ProRes/AAC/FLAC/ALAC；VP9/AV1 看系统版本 | 好，偏好不同 |
| Linux | WebKitGTK（GStreamer） | 取决于用户安装的 gst 插件，H.264 经常缺失 | 差，暂缓支持 |

**对策**：WebView 只播 FFmpeg 产出的 H.264(baseline)+AAC+MP4——三内核 100% 交集。系统有没有 HEVC 扩展、装没装解码器，与应用完全无关（FFmpeg 自带 HEVC 软解）。首发 Win+macOS 后此风险基本清零。

### 4.2 其他已知坑

| 坑 | 对策 |
|---|---|
| HEIC 是全系最麻烦依赖（libheif C 绑定在 Windows 需 vcpkg） | 优先纯 Rust 的 `imazen/heic` 解码器；或先只抽内嵌缩略图 |
| RAW 全尺寸解码慢、占内存 | 快路径：先抽内嵌 JPEG 秒开，后台再 rawler 全尺寸解码 |
| FFmpeg 转码流无法原生 seek | 前端 seek 时杀旧进程，带 `-ss <t>` 重启转码管道 |
| WKWebView 对自定义协议有怪癖 | 兜底：Rust 内嵌 tiny_http/axum 起本地 HTTP 服务（loopback，不过网卡） |
| FFmpeg 许可：带 x264/x265 编码器即 GPL | 预览期用 LGPL 构建（只解码，全覆盖）；做转换功能时再评估 |
| H.264/AAC 解码的 MPEG-LA 专利 | 个人/开源/小体量实务无追偿；商业化上规模后评估 |
| macOS 公证 | sidecar 二进制需单独签名 |
| 扩展名不可信（.json 可能是 Lottie；.m4s 与 .mp4 同构） | 格式识别：扩展名初筛 + 魔数/字段嗅探兜底（见 method.md §2） |

## 5. 总体架构

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
│  ⑦ 持久化层：SQLite（§8）                                             │
└──────────────────────────────────────────────────────────────────────┘
```

## 6. FFmpeg 集成：Sidecar 模式

| 方案 | 优点 | 缺点 | 结论 |
|---|---|---|---|
| **Sidecar 二进制**（externalBin + `ffmpeg-sidecar` crate） | 进程隔离、升级换二进制即可、LGPL 合规简单 | 包体 +40-80MB/平台 | ✅ 采用 |
| ffmpeg-next 绑定 | 进程内、帧级控制 | 编译链复杂、GPL 风险、崩溃带走主程序 | 二期需要精细控制再考虑 |
| ffmpeg.wasm | 无后端依赖 | 慢 10-20 倍、大文件内存爆炸 | ❌ 不用 |

## 7. 流传输实现

- **本地安全格式**（method.md §3 级别 1）：`asset://` + `convertFileSrc`，内置 Range/206 与 seek，零代码
- **FFmpeg 转码流**：`register_uri_scheme_protocol` 注册 `stream://`，自行解析 `Range` header，返回 `206 + Content-Range + Accept-Ranges: bytes`；seek 时重启带 `-ss` 的转码进程
- **兜底**（WKWebView 协议怪癖）：Rust 内嵌 tiny_http/axum 本地 HTTP 服务（127.0.0.1 loopback，GB/s 级内存拷贝，不经过网卡）
- **禁止**：媒体字节走 `invoke` IPC（48ms 主线程阻塞）

## 8. 前端技术栈

| 层 | 选型 | 理由 |
|---|---|---|
| 构建 | Vite + TypeScript | Tauri 官方模板标配 |
| 框架 | **React 19** | 面板布局/文件树/菜单原语有生产级现成库，宫格难点 UI 不用自研 |
| 样式 | Tailwind CSS v4 + CSS 变量主题 | 桌面应用要紧凑自定义 UI；**不引** Ant Design 等重型组件库 |
| 菜单/对话框 | Radix Primitives（ContextMenu/Dialog 等） | headless，风格自控 |
| 状态管理 | zustand | store 仅四五个：宫格数组/选中格/当前文件夹/设置/媒体配额 |
| 面板布局 | react-resizable-panels | 对应 layout.md §1 的 frame 宽高调整 |
| 文件树 | 自绘树 + @tanstack/react-virtual 虚拟滚动 | 大目录不卡 |
| 拖拽 | 内部 HTML5 DnD；**OS 拖入走 Tauri dragDrop 事件**（拿绝对路径，不是 HTML5 DnD） | 两条通道都要接 |
| 媒体/渲染 | three.js、lottie-web、pdfjs-dist、原生 `<video>`+自制控制条、markdown-it + shiki | 见 method.md |
| 与 Rust 通道 | @tauri-apps/api（invoke/event 传元数据）+ `convertFileSrc`/`stream://`（媒体字节，铁律 2） | |

### 8.1 兼容性约束

需同时兼容 WebView2（Chromium）与 WKWebView（Safari 系）两个内核：避免 Chrome-only API，browserslist 按双内核配置，关键交互（Range 播放、拖拽、全屏）两平台都要验证。

### 8.2 两个已知限制与对策

1. **WebGL 上下文上限**（单页约 8-16 个，9×9=81 宫格多格同时放 3D 会爆）：空白宫格不挂 canvas（成本≈0）；**激活 3D 视口数上限可调（顶部栏设置，默认 3，硬上限 8）**，超出的宫格显示该模型最后渲染帧的静态截图，点击截图激活该格、同时把最久未交互的已激活视口降级为截图（共享 renderer 离屏合成可作为后续优化）
2. **并发流媒体配额**：同时播放/解码的视频音频流上限可调（顶部栏设置，默认 5），第 N+1 路起播时自动暂停最久未交互的一路（保留其播放进度，被暂停宫格显示海报帧；手动恢复时若仍超额同样挤占）

## 9. 数据持久化

### 9.1 持久化内容

| 数据 | 粒度 | 写入时机 | 恢复行为 |
|---|---|---|---|
| 当前打开的文件夹（含树展开状态） | 全局单例 | 变更时 | 启动时恢复（默认桌面） |
| 宫格布局 m×n、窗口/frame 尺寸 | 全局单例 | 变更时 | 启动时恢复 |
| 预览历史（打开过的文件及次数/时间） | 每文件一条 | 每次打开预览 | 供"记录管理"与最近列表使用 |
| 视频/音频播放位置 | 每文件一条 | 暂停时 + 播放中每 5s + 宫格关闭/应用退出时 | 再次打开自动续播（可 toast 提示"已从 mm:ss 继续"） |
| 文本/PDF 滚动位置（含页码、缩放） | 每文件一条 | 滚动停止 500ms 防抖 + 宫格关闭时 | 再次打开自动恢复滚动位置/页码/缩放 |
| 3D 视角（相机位置/目标点/焦距/朝向） | 每文件一条 | 交互停止 500ms 防抖 + 宫格关闭时 | 再次打开自动恢复视角 |

### 9.2 文件标识与失效处理

- **主键**：绝对路径；**校验**：记录同时保存 mtime + size
- mtime/size 不匹配 → 文件已被修改：位置类记录（播放/滚动/视角）**重置**，历史记录保留并更新元信息
- 路径不存在 → 记录标记 `missing`，记录管理界面中灰显，可一键"清理失效记录"

### 9.3 存储方案：SQLite（rusqlite）

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

### 9.4 可选择性删除（记录管理）

- 入口：顶部栏设置 → **记录管理**（layout.md §2）
- 界面按类型分组列出全部记录（预览历史 / 播放位置 / 文档位置 / 3D 视角），支持：
  - 单条删除、勾选多条删除
  - 按类型清空、全部清空
  - 一键清理失效（文件已不存在）记录
- **保留策略**（设置项）：条数上限（默认 500，超出淘汰最旧）或按保留天数（默认不限）
- 全部数据仅存本地，不上传不同步；删除 db 文件即恢复出厂状态

## 10. 未来格式转换的架构预留

预览与转换共用 Job 引擎，概念骨架：

```rust
enum Job {
    Preview { input: PathBuf, target: PreviewTarget },              // 流式、低码率
    Convert { input: PathBuf, output: PathBuf, format: Format, opts: ConvertOpts },
}
// + 任务队列 / 进度 event 推前端 / 取消句柄
```

"新增转换格式" = 往注册表加一条模板，不动架构。各格式的具体转换方法见 method.md §8。

## 11. 打包与合规

| 事项 | 说明 |
|---|---|
| 包体 | Tauri 壳 ~15MB + FFmpeg 40-80MB/平台 ≈ 60-100MB |
| FFmpeg 许可 | 预览期 LGPL 构建（只解码）可闭源分发；转换功能需要编码器时再面对 GPL 问题 |
| 专利 | H.264/AAC/HEVC 解码涉及专利池，商业化上规模后评估 |
| macOS | sidecar 单独签名 + 公证 |

## 12. 里程碑

1. **M1 架构验证**：Tauri 2 + ffmpeg-sidecar，打通视频四级预览管道（最难、最能验证架构）+ stream:// 协议 Range/seek
2. **M2 图片 + 持久化基础设施**：格式识别层 + 解码器注册表 + 缩略图缓存 + SQLite 持久化层（§9，文件夹/历史先行）
3. **M3 音频**：FFmpeg 音频流 + 波形 + MIDI；播放位置持久化接线
4. **M4 3D/动效/文档**：three.js、lottie-web、pdf.js（最简单，纯前端）；视角/滚动位置持久化接线
5. **M5 转换功能**：Job 引擎加 Convert 出口 + FFmpeg 命令模板库

## 参考资料

- [Tauri v2 Sidecar 文档](https://v2.tauri.app/develop/sidecar/) · [ffmpeg-sidecar](https://github.com/nathanbabcock/ffmpeg-sidecar) · [docs.rs](https://docs.rs/crate/ffmpeg-sidecar/latest)
- [Tauri 流媒体 issue #4133](https://github.com/tauri-apps/tauri/issues/4133) · [IPC 带宽墙分析](https://www.mechanicalrock.io/blog/it-s-physics-not-a-bug-the-ipc-bandwidth-wall-in-webview-apps) · [vaultbox 自定义协议实现](https://github.com/bldgk/vaultbox)
- [QL-Win/QuickLook](https://github.com/QL-Win/QuickLook)（竞品参考）
- 各格式专用库/方法的出处见 [method.md](method.md) 末尾
