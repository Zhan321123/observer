# Obverser — 框架选型与铁律限制

> 版本：v0.3（2026-08-29，由 design.md 的选型/铁律/风险章节 + task.md 的已知限制整理而来）
> 关联文档：[design.md](design.md)（设计理念）· [layout.md](layout.md)（布局与功能）· [method.md](method.md)（各格式的识别/预览/转换方法）
> 本文回答三件事：**用什么框架与库、必须遵守哪些铁律、当前有哪些限制**。

## 1. 技术选型

**Tauri 2（Rust 后端）+ 系统 WebView 前端**

| 对比项 | Tauri/Rust（选用） | Electron/Node |
|---|---|---|
| 包体 | ~15MB 壳 + FFmpeg ≈ 60-100MB | ~250MB+ |
| 内存/启动 | 优 | 一般 |
| 格式覆盖上限 | 相同（都由 FFmpeg 决定） | 相同 |
| 3D 预览 | 相同（都是 WebGL） | 相同 |
| 格式转换（未来） | Rust 直接调 FFmpeg/原生解码库，顺 | child_process + node-addon，绕 |
| 全平台渲染一致性 | WebView 内核不一（风险，见 §6） | 全平台 Chromium，一致 |
| 开发速度/生态 | Rust 媒体生态 2025 已补齐 | npm 现成包更多，开发更快 |

## 2. 架构铁律（三条）

1. **解码永远发生在 Rust 侧**（FFmpeg sidecar + Rust crates），WebView 只消费"安全格式"：H.264(baseline)+AAC 的 MP4 流、PNG/WebP 位图、PCM 音频。
2. **媒体字节流走 protocol / localhost HTTP，不走 IPC**。实测二进制走 `invoke` IPC 阻塞 WebView 主线程 ~48ms（卡顿），走自定义 protocol 为 0ms。IPC/event 只传元数据、缩略图、进度事件。大文件因此与 C++ 原生播放器同为"看一段读一段"：Range 请求 → seek+read 分块，内存占用与文件大小无关，10GB 文件秒开。
3. **预览与转换共用一个 Job 引擎**。预览 = 解码 → 编码为 Web 安全格式（实时流）；转换 = 解码 → 编码为用户指定格式（写文件）。同一条管道，两个出口。

## 3. 流传输实现

- **本地安全格式**（method.md §3 级别 1）：`asset://` + `convertFileSrc`，内置 Range/206 与 seek，零代码
- **FFmpeg 转码流（M1 已实现，有偏差）**：⚠️ **实际采用 loopback HTTP 而非 `stream://` 自定义协议**。原因：`register_uri_scheme_protocol` 的响应体须整段在内存（`Cow<[u8]>`），无法"边转边播"大文件——与铁律 2 的流式目标冲突。故直接采用下方原列为兜底的方案：Rust 内嵌 `tiny_http` 起 127.0.0.1 loopback 服务，ffmpeg stdout 作为响应体 chunked 流式输出；seek 时前端改 URL 的 `t` 参数、后端杀旧进程带 `-ss` 重启（进程随响应 Drop 回收）。已实测输出合法 fMP4。
- ~~原方案 `stream://` 自行解析 `Range` 返回 `206`~~（因上述内存限制弃用；若未来 Tauri 支持流式响应体可再评估）
- **禁止**：媒体字节走 `invoke` IPC（48ms 主线程阻塞）

## 4. FFmpeg 集成：Sidecar 模式

| 方案 | 优点 | 缺点 | 结论 |
|---|---|---|---|
| **Sidecar 二进制**（externalBin + `ffmpeg-sidecar` crate） | 进程隔离、升级换二进制即可、LGPL 合规简单 | 包体 +40-80MB/平台 | ✅ 采用 |
| ffmpeg-next 绑定 | 进程内、帧级控制 | 编译链复杂、GPL 风险、崩溃带走主程序 | 二期需要精细控制再考虑 |
| ffmpeg.wasm | 无后端依赖 | 慢 10-20 倍、大文件内存爆炸 | ❌ 不用 |

## 5. 前端技术栈

| 层 | 选型 | 理由 |
|---|---|---|
| 构建 | Vite + TypeScript | Tauri 官方模板标配 |
| 框架 | **React 19** | 面板布局/文件树/菜单原语有生产级现成库，宫格难点 UI 不用自研 |
| 样式 | Tailwind CSS v4 + CSS 变量主题 | 桌面应用要紧凑自定义 UI；**不引** Ant Design 等重型组件库 |
| 菜单/对话框 | Radix Primitives（ContextMenu/Dialog 等） | headless，风格自控 |
| 状态管理 | zustand | store 仅四五个：宫格数组/选中格/当前文件夹/设置/媒体配额 |
| 面板布局 | react-resizable-panels | 对应 layout.md §1 的 frame 宽高调整 |
| 文件树 | 自绘树 + @tanstack/react-virtual 虚拟滚动 | 大目录不卡 |
| 拖拽 | 内部 HTML5 DnD；**OS 拖入走 Tauri dragDrop 事件**（拿绝对路径，不是 HTML5 DnD） | 两条通道都要接（互斥限制见 §8） |
| 媒体/渲染 | three.js、lottie-web、pdfjs-dist、原生 `<video>`+自制控制条、markdown-it + shiki | 见 method.md |
| 与 Rust 通道 | @tauri-apps/api（invoke/event 传元数据）+ `convertFileSrc`（媒体字节，铁律 2） | |

### 5.1 兼容性约束

需同时兼容 WebView2（Chromium）与 WKWebView（Safari 系）两个内核：避免 Chrome-only API，browserslist 按双内核配置，关键交互（Range 播放、拖拽、全屏）两平台都要验证。

### 5.2 两个已知限制与对策

1. **WebGL 上下文上限**（单页约 8-16 个，9×9=81 宫格多格同时放 3D 会爆）：空白宫格不挂 canvas（成本≈0）；**激活 3D 视口数上限可调（顶部栏设置，默认 3，硬上限 8）**，超出的宫格显示该模型最后渲染帧的静态截图，点击截图激活该格、同时把最久未交互的已激活视口降级为截图（共享 renderer 离屏合成可作为后续优化）
2. **并发流媒体配额**：同时播放/解码的视频音频流上限可调（顶部栏设置，默认 5），第 N+1 路起播时自动暂停最久未交互的一路（保留其播放进度，被暂停宫格显示海报帧；手动恢复时若仍超额同样挤占）

## 6. 关键风险与对策

### 6.1 WebView 三内核编解码差异（Tauri 相对 Electron 唯一短板）

| 平台 | 内核 | 能力 | 评价 |
|---|---|---|---|
| Windows | WebView2（Chromium） | H.264/AAC/MP3/VP9/AV1；HEVC 需系统装商店扩展（约 ¥7，OEM 机常预装） | 很好 |
| macOS | WKWebView（Safari） | H.264/HEVC/ProRes/AAC/FLAC/ALAC；VP9/AV1 看系统版本 | 好，偏好不同 |
| Linux | WebKitGTK（GStreamer） | 取决于用户安装的 gst 插件，H.264 经常缺失 | 差，暂缓支持 |

**对策**：WebView 只播 FFmpeg 产出的 H.264(baseline)+AAC+MP4——三内核 100% 交集。系统有没有 HEVC 扩展、装没装解码器，与应用完全无关（FFmpeg 自带 HEVC 软解）。首发 Win+macOS 后此风险基本清零。

### 6.2 其他已知坑

| 坑 | 对策 |
|---|---|
| HEIC 是全系最麻烦依赖（libheif C 绑定在 Windows 需 vcpkg） | 优先纯 Rust 的 `imazen/heic` 解码器；或先只抽内嵌缩略图 |
| RAW 全尺寸解码慢、占内存 | 快路径：先抽内嵌 JPEG 秒开，后台再 rawler 全尺寸解码 |
| FFmpeg 转码流无法原生 seek | 前端 seek 时杀旧进程，带 `-ss <t>` 重启转码管道 |
| WKWebView 对自定义协议有怪癖 | 兜底：Rust 内嵌 tiny_http/axum 起本地 HTTP 服务（loopback，不过网卡）——M1 起实际即采用此方案（§3） |
| FFmpeg 许可：带 x264/x265 编码器即 GPL | 预览期用 LGPL 构建（只解码，全覆盖）；做转换功能时再评估 |
| H.264/AAC 解码的 MPEG-LA 专利 | 个人/开源/小体量实务无追偿；商业化上规模后评估 |
| macOS 公证 | sidecar 二进制需单独签名 |
| 扩展名不可信（.json 可能是 Lottie；.m4s 与 .mp4 同构） | 格式识别：扩展名初筛 + 魔数/字段嗅探兜底（见 method.md §2） |

## 7. 打包与合规

| 事项 | 说明 |
|---|---|
| 包体 | Tauri 壳 ~15MB + FFmpeg 40-80MB/平台 ≈ 60-100MB |
| FFmpeg 许可 | 预览期 LGPL 构建（只解码）可闭源分发；转换功能需要编码器时再面对 GPL 问题 |
| 专利 | H.264/AAC/HEVC 解码涉及专利池，商业化上规模后评估 |
| macOS | sidecar 单独签名 + 公证 |

## 8. 当前版本已知限制

- [ ] **`dragDropEnabled=true` 与页面内 HTML5 DnD 互斥**（Tauri 限制）：为让 OS 拖入能拿到绝对路径必须开 `dragDropEnabled`，代价是页面内 HTML5 拖放被禁用，故内部拖拽改用 pointer 事件自实现（`lib/pointerDrag.ts`）。参考：[tauri#9421](https://github.com/tauri-apps/tauri/issues/9421)。
- [ ] asset 协议 scope 为宽放行（`**/*`）+ 运行时授权；对外分发前应收紧，并考虑 `tauri-plugin-persisted-scope` 持久化授权（免每次重开授权）
- [ ] 超大文本（GiB 级）一次性读入渲染（现有 10MB 阈值 + 确认门槛，后端 1 GiB 护栏；真正的流式/分块渲染未做）
- [ ] 平台验证：仅 Windows；macOS（sidecar 需签名公证）、Linux（WebKitGTK 编解码差，§6.1 暂缓）未做
- [ ] FFmpeg 随包分发：当前依赖 PATH/环境变量；打包需 externalBin 放置二进制并处理许可（LGPL 解码构建 vs 本机 GPL 含 x264）
