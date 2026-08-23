# Observer — 任务清单(未完成项)

> 已完成内容见 [README.md](README.md) 的"当前进度"。本文档登记**未做**的功能与已知限制,按 design.md §12 的里程碑组织。架构已为每项留好接口(格式注册表 / Job 引擎占位 / 持久化层占位)。

## 新增功能需求(2026-08-23)—— ✅ 全部完成

### 宫格与交互
- [x] **拖文件到指定宫格打开**:文件 frame 拖文件落到某宫格即在该格打开。**已实现**。
  - OS 拖入:走 `tauri://drag-drop` 事件([useOsDrop](observer-react/src/hooks/useOsDrop.ts)),拿绝对路径。
  - 文件 frame → 宫格:**自实现 pointer 拖拽**(`dragDropEnabled=true` 会禁用页面内 HTML5 DnD,见下"已知限制"),落点经 `detect_format` 定 kind,强制覆盖该格;落点有悬停高亮。
  - 落点文件:`lib/pointerDrag.ts`、`stores/dragStore.ts`、`components/DragGhost.tsx`、`FileTree.tsx`(源)、`GridCell.tsx`(落点/高亮)。
- [x] **宫格占满时打开文件的覆盖策略**(设置项):`selected` 选中的宫格(**默认**)/ `first` 第一宫格 / `sequential` 从第一宫格开始依次向后。**已实现**:`settingsStore.gridFullPolicy`;`gridStore.placeFile` 无空格分支按策略选格(sequential 用会话内轮转游标);设置对话框有对应下拉。
- [x] **宫格标题栏加刷新按钮**:**已实现**。`gridStore.refreshCell(id)` 重跑 `detect_format`(更新 kind/ext)并自增 `cellViewStore.views[id].reloadKey`;`GridCell` 给预览组件加 `key={reloadKey}` 触发重挂载 → 文本重读、媒体/图片重建;同时清错误态以重试。
- [x] **宫格标题栏文件名右键 → 在资源管理器中打开**:**已实现**(见下"右键菜单")。

### 文本预览增强(`TextView.tsx` + `FunctionBar.tsx` 文本组)—— ✅ 全部完成
- [x] **行号开关**(默认关):代码/文本按行渲染行号(sticky gutter,与代码同字号行高对齐;**自动换行开启时隐藏行号**,避免折行错位)。markdown 不提供。
- [x] **自动换行开关**(默认关):`white-space: pre-wrap / pre` 切换(换行 vs 横向滚动)。
- [x] **复制全文**:一键复制 `TextView` 全文(clipboard 插件 `writeText`)。
- [x] **Ctrl+滚轮调字号**:`TextView` wheel 监听,`ctrlKey` 时增减 `fontSize`(8..32,复用 zoomText);纯滚轮仍滚动内容(§4.5 不变)。仅选中格生效。

### 文件列表与右键菜单 —— ✅ 全部完成
- [x] **打开的文件每项右侧加叉号**:点击关闭对应宫格(`closeCell(id)`)。落点:`OpenedFilesList.tsx`(悬停显现)。
- [x] **右键菜单"在资源管理器中打开"**:三处都有 —— ① 文件 frame 文件项 ② 打开的文件列表项 ③ 宫格标题栏文件名。**已实现**:自绘 `components/ContextMenu.tsx` + `stores/contextMenuStore.ts`(全局单例),菜单项 = 在资源管理器中打开(`revealInExplorer`)+ 复制路径(`copyPath`)。

### 历史记录(M2 扩展)—— ✅ 完成
- [x] **顶部栏新增"历史"**:点击显示所有浏览记录(文件名/路径/大小/打开次数/最后打开时间),点击重开进首空格,单条删除 + "清空历史记录"。落点:`TopBar` 按钮 + `components/HistoryDialog.tsx`;数据经 `preview_history` 表(`history_open` 在 `gridStore.placeFileAt` 汇聚点记录)。

### 持久化(M2 扩展)—— ✅ 完成
- [x] **持久化宫格全景**:宫格布局(cols/rows)+ 每格打开的文件 + 每格视图位置(播放进度/滚动/缩放)+ **选中宫格**,重启后整体恢复。**已实现**:M2 SQLite —— `app_state` 存布局/选中/当前文件夹/设置项,`media_position`/`doc_position` 按 path 存播放进度、文本滚动+字号、图片平移缩放;`gridStore.hydrate` 还原,`lib/persistence.ts` 编排(bootstrap 还原 + 订阅防抖写回,启动以 `ready` 门控)。

## M1 — 视频四级管道 + FFmpeg —— ✅ 主体完成并经实机验证

- [x] **FFmpeg 集成**:`observer-tauri/src/ffmpeg.rs`。二进制解析顺序:环境变量(`OBSERVER_FFMPEG`/`OBSERVER_FFPROBE`)→ 可执行文件旁(打包 sidecar 位)→ PATH。用 `std::process::Command` 直接驱动(全参数控制 + stdout 管道)。**注**:对外分发还需把二进制随包放置(externalBin/bundle)+ 处理 LGPL/GPL 许可(§11),本机开发走 PATH 即可。
- [x] **流传输**:⚠️ **改用 loopback HTTP 而非 `stream://` 自定义协议** —— 因 Tauri `register_uri_scheme_protocol` 要求整个响应体在内存(`Cow<[u8]>`),无法边转边播大文件;故按 design.md §7 的兜底方案起 `tiny_http` 127.0.0.1 服务(不过网卡),ffmpeg stdout 作为响应体流式输出(chunked)。seek = 前端改 URL 的 `t` 参数重启(后端杀旧进程带 `-ss` 重起,`ChildPipe` Drop 时回收进程)。已实测:HTTP 200 + 合法 fMP4。
- [x] **视频四级兜底**:直放(asset://,M0 已有)→ remux(`-c copy` 换封装,CPU≈0,已实测)→ 实时转码 H.264+AAC(`-movflags frag_keyframe+empty_moov`,已实测 mpeg2→h264)→ ~~HDR `zscale+tonemap` 转 SDR~~(**留后续细化**,当前 HDR 片源走普通转码可播但可能偏色)。VP9/AV1 等 WebView 可播编码走 remux(vp9-in-mp4 已实测)。
- [x] **ffprobe 元信息**(编码/时长/码率/帧率/HDR)→ 已填充文件信息框(视频:分辨率/时长/帧率/视频编码/音频编码/采样率/声道/码率/HDR 标识)。
- [~] **视频缩略图**:`video_thumbnail` 命令已实现并验证(磁盘缓存 key=路径+size,`-frames:v 1` 截图 PNG);**尚未接入 UI**(文件树缩略图 / 进度条雪碧图留后续)。
- [x] **B 站缓存特例**:同目录成对 `video.m4s + audio.m4s` 双输入合并(已实测:请求 video.m4s 自动合并出带音频流)。

**验证**:`cargo test` 5 项全过(ffprobe 解析 / 流服务 fMP4 / DB 三组);并起真实 app 用 curl 打流端点实测 remux / 转码 / seek / B 站合并 / 截图命令全部通过。测试样例由 ffmpeg lavfi 现生成。

## M2 — 图片解码 + 持久化基础设施

当前 RAW/HEIC/PSD/TIFF 等显示"后续里程碑"占位。**持久化基础设施(SQLite)已完成**(见上"持久化");其余如下。

- [x] SQLite 持久化层(rusqlite,bundled):`app_state / preview_history / media_position / doc_position / threed_camera`(`observer-tauri/src/db.rs` + `observer-react/src/lib/persist.ts`;核心逻辑与命令分离,含单测)
- [x] 播放位置 / 文本滚动位置 / 图片缩放平移 / 宫格布局·选中格 / 当前文件夹 / 设置项 的保存与恢复
- [ ] 记录管理界面(按类型分组、单条/勾选删除、按类型清空、清理失效记录、保留策略)—— 目前仅有顶栏"历史"(预览历史的查看/单删/清空)
- [ ] 文件失效检测的完整接线:mtime/size 校验→位置类记录重置、`missing` 灰显(目前 `history_open` 已记 missing 标志 + 历史对话框灰显,其余随记录管理界面)
- [ ] 图片解码:RAW(`rawler`)、HEIC(`imazen/heic`)、PSD(`psd`)、TIFF/TGA/EXR 等(`image` crate)
- [ ] 图片 EXIF 摘要 / 色彩空间
- [ ] 图片缩略图管线:worker 池 + 磁盘缓存(视频缩略图命令已有,图片版 worker 池待做)

## M3 — 音频进阶

- [ ] MIDI(mid/midi):`rustysynth` SoundFont 合成 → PCM → Web Audio
- [ ] Tracker/Chiptune(mod/xm/s3m/it):libopenmpt
- [ ] 波形可视化:FFmpeg 抽 PCM 峰值 → 前端 canvas
- [ ] 非常规音频(ape/wv/tta/wma/aiff/dsf…)经 FFmpeg 流式解码(可复用 M1 的 loopback 流服务 + 前端音频视图)

## M4 — 3D / 动效 / 文档

- [ ] 3D:three.js loaders(GLTF/GLB/OBJ/FBX/STL/PLY/DAE/3DS/3MF/PCD/BVH/VOX),滚轮缩放 + 拖动旋转;视角持久化(`threed_camera` 表已建);激活视口配额(截图降级)
- [ ] Lottie(.json):lottie-web —— 目前已能嗅探识别,但按文本预览,未渲染为动效
- [ ] dotLottie(.lottie)/ Rive(.riv)/ SVGA(.svga)
- [ ] PDF(pdf.js):页码跳转 / 缩放 / 滚动位置持久化(`doc_position.page` 已预留)

## M5 — 格式转换

当前转换 frame 为"暂不可用"占位(架构已按 design.md §10 预留)。

- [ ] Job 引擎加 Convert 出口(与预览共用同一管道)
- [ ] FFmpeg 命令模板库(视频/音频转换)
- [ ] 图片编解码(解码 → image crate 编码 png/jpg/webp/tiff;AVIF 用 ravif)
- [ ] 3D 导出(three.js exporter GLB/STL/OBJ/PLY)
- [ ] 转换 frame UI:目标格式/参数选择、任务提交、进度显示

## 当前版本已知限制 / TODO(小项)

- [ ] **`dragDropEnabled=true` 与页面内 HTML5 DnD 互斥**(Tauri 限制):为让 OS 拖入能拿到绝对路径(asset 协议 + Rust 命令都基于路径),必须开 `dragDropEnabled`,代价是页面内 HTML5 拖放被禁用。因此**内部拖拽(文件树→宫格、宫格→宫格)改用 pointer 事件自实现**(`lib/pointerDrag.ts`)。后续若需要更复杂的拖拽反馈(拖拽中滚动容器等)在此基础上扩展。参考:[tauri#9421](https://github.com/tauri-apps/tauri/issues/9421)。
- [ ] **资源配额强制执行**:流媒体路数、3D 视口上限的设置 UI 已有,但"超额自动暂停最久未交互一路 / 视口降级为截图"未实现(layout.md §4.7)
- [ ] 文件树未虚拟滚动(`@tanstack/react-virtual`),超大目录可能卡(§3 已预留)
- [ ] 窗口尺寸 / 树展开状态重启后不保留(宫格布局/选中/各格文件/当前文件夹/设置项/各视图位置已持久化;窗口尺寸与树展开待补)
- [ ] 图片全屏切换后:缩放模式与倍率保留,但 free 模式的精确平移位置会重置(注:图片平移/缩放现已按 path 持久化,重启可恢复;此处指全屏切换的瞬态)
- [ ] 视频逐帧为近似步长(1/30s),非真实帧率(ffprobe 帧率已可得,可改精确)
- [ ] markdown 渲染未加 DOMPurify(仅渲染本地可信文件;渲染不可信内容前必须加)
- [ ] asset 协议 scope 为宽放行(`**/*`)+ 运行时授权;对外分发前应收紧,并考虑 `tauri-plugin-persisted-scope` 持久化授权(免每次重开授权)
- [ ] 文本文件 > 5 MiB 直接拒读(后续可改流式/分块读取)
- [ ] 平台验证:仅 Windows;macOS(sidecar 需签名公证)、Linux(WebKitGTK 编解码差,design.md §4 暂缓)未做
- [ ] FFmpeg 随包分发:当前依赖 PATH/环境变量;打包需 externalBin 放置二进制并处理许可(LGPL 解码构建 vs 本机 GPL 含 x264)
