# Observer — 任务清单(未完成项)

> 已完成内容见 [README.md](README.md) 的"当前进度"。本文档登记**未做**的功能与已知限制,按 design.md §12 的里程碑组织。架构已为每项留好接口(格式注册表 / Job 引擎占位 / 持久化层占位)。

## 新增功能需求(2026-08-23)

### 宫格与交互
- [x] **拖文件到指定宫格打开**:文件 frame 拖文件落到某宫格即在该格打开。**已实现**。
  - OS 拖入:走 `tauri://drag-drop` 事件([useOsDrop](observer-react/src/hooks/useOsDrop.ts)),拿绝对路径。
  - 文件 frame → 宫格:**自实现 pointer 拖拽**(`dragDropEnabled=true` 会禁用页面内 HTML5 DnD,见下"已知限制"),落点经 `detect_format` 定 kind,强制覆盖该格;落点有悬停高亮。
  - 落点文件:`lib/pointerDrag.ts`、`stores/dragStore.ts`、`components/DragGhost.tsx`、`FileTree.tsx`(源)、`GridCell.tsx`(落点/高亮)。
- [ ] **宫格占满时打开文件的覆盖策略**(设置项,新增):`selected` 选中的宫格(**默认**)/ `first` 第一宫格 / `sequential` 从第一宫格开始依次向后。落点:`settingsStore` 加 `gridFullPolicy`;`gridStore.placeFile` 在"无空格"分支按策略选目标格(当前写死覆盖 0 号格)。
- [ ] **宫格标题栏加刷新按钮**:文件打开后可能被外部修改;点刷新重读该格(重新 `detect_format` + 重载预览:文本重读、媒体/图片重建)。落点:`GridCell` 标题条,给预览组件加 reload 信号(如递增 `reloadKey` 触发重挂载/重读)。
- [ ] **宫格标题栏文件名右键 → 在资源管理器中打开**(见下"右键菜单")。

### 文本预览增强(落点:`TextView.tsx` + `FunctionBar.tsx` 文本组)
- [ ] **行号开关**(默认关闭):代码/文本按行渲染行号。
- [ ] **自动换行开关**(默认关闭):行太宽时换行显示 vs 横向滚动(切换 `white-space: pre-wrap / pre`)。
- [ ] **复制全文**:一键复制 `TextView` 全文(复用 clipboard,同 `copyPath`)。
- [ ] **Ctrl+滚轮调字号**:`TextView` wheel 监听,`ctrlKey` 时增减 `fontSize`(复用现有 zoomText;纯滚轮仍滚动内容,§4.5 不变)。

### 文件列表与右键菜单
- [ ] **打开的文件每项右侧加叉号**:点击关闭对应宫格(`closeCell(id)`)。落点:`OpenedFilesList.tsx`。
- [ ] **右键菜单"在资源管理器中打开"**:三处都要 —— ① 文件 frame 的文件项 ② 打开的文件列表项 ③ 宫格标题栏文件名。落点:自绘 context menu 组件(右键弹"在资源管理器中打开"→ `revealInExplorer(path)`,可顺带"复制路径")。

### 历史记录(M2 扩展)
- [ ] **顶部栏新增"历史"**:点击显示所有浏览记录(含打开时间),提供"清空历史记录"。依赖 M2 的 `preview_history` 表;落点:`TopBar` 加按钮 + 历史面板/对话框。

### 持久化(M2 扩展)
- [ ] **持久化宫格全景**:宫格布局(cols/rows)+ 每格打开的文件 + 每格视图位置(播放进度/滚动/缩放)+ **选中宫格**,重启后整体恢复。即把原"视频位置"持久化(§9.1)全面拓展到宫格级。落点:M2 SQLite —— `app_state`(布局/选中)+ 各位置表;`gridStore`/`cellViewStore` 序列化出入。

## M1 — 视频四级管道 + FFmpeg(架构验证,优先级最高)

当前 mkv/ts/mov/wmv/flv/avi/hevc 等显示"后续里程碑"占位。

- [ ] FFmpeg sidecar 集成(externalBin + `ffmpeg-sidecar` crate,进程隔离,LGPL 构建)
- [ ] `stream://` 自定义协议:解析 `Range` header,返回 `206 + Content-Range`,seek 时杀旧进程带 `-ss` 重启
- [ ] 视频四级兜底:直放(已有)→ remux(`-c copy`)→ 实时转码 H.264+AAC → HDR `zscale+tonemap` 转 SDR
- [ ] ffprobe 元信息(编码/时长/码率/帧率/HDR)→ 填充文件信息框
- [ ] 视频缩略图 / 预览雪碧图(`-fps 1/10 + tile`)
- [ ] B 站缓存特例:同目录成对 `video.m4s + audio.m4s` 双输入合并

## M2 — 图片解码 + 持久化基础设施

当前 RAW/HEIC/PSD/TIFF 等显示"后续里程碑"占位;所有状态仅存内存。

- [ ] SQLite 持久化层(rusqlite):`app_state / preview_history / media_position / doc_position / threed_camera`(见 design.md §9,占位:`observer-tauri/src/db.rs`、`observer-react/src/lib/persist.ts`)
- [ ] 播放位置 / 文本·PDF 滚动位置 / 3D 视角 / 宫格布局·窗口尺寸的保存与恢复
- [ ] 记录管理界面(按类型分组、单条/勾选删除、按类型清空、清理失效记录、保留策略)
- [ ] 文件失效检测:mtime/size 校验、路径不存在标记 `missing`、记录管理灰显
- [ ] 图片解码:RAW(`rawler`)、HEIC(`imazen/heic`)、PSD(`psd`)、TIFF/TGA/EXR 等(`image` crate)
- [ ] 图片 EXIF 摘要 / 色彩空间
- [ ] 缩略图管线:worker 池 + 磁盘缓存(key = 路径+mtime+size)

## M3 — 音频进阶

- [ ] MIDI(mid/midi):`rustysynth` SoundFont 合成 → PCM → Web Audio
- [ ] Tracker/Chiptune(mod/xm/s3m/it):libopenmpt
- [ ] 波形可视化:FFmpeg 抽 PCM 峰值 → 前端 canvas

## M4 — 3D / 动效 / 文档

- [ ] 3D:three.js loaders(GLTF/GLB/OBJ/FBX/STL/PLY/DAE/3DS/3MF/PCD/BVH/VOX),滚轮缩放 + 拖动旋转;视角持久化;激活视口配额(截图降级)
- [ ] Lottie(.json):lottie-web —— 目前已能嗅探识别,但按文本预览,未渲染为动效
- [ ] dotLottie(.lottie)/ Rive(.riv)/ SVGA(.svga)
- [ ] PDF(pdf.js):页码跳转 / 缩放 / 滚动位置持久化

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
- [ ] 宫格布局 / 窗口尺寸 / 树展开状态 / 设置项重启后不保留(随 M2 持久化解决)
- [ ] 图片全屏切换后:缩放模式与倍率保留,但 free 模式的精确平移位置会重置
- [ ] 视频逐帧为近似步长(1/30s),非真实帧率(需 ffprobe 帧率,M1 后改精确)
- [ ] markdown 渲染未加 DOMPurify(仅渲染本地可信文件;渲染不可信内容前必须加)
- [ ] asset 协议 scope 为宽放行(`**/*`)+ 运行时授权;对外分发前应收紧,并考虑 `tauri-plugin-persisted-scope` 持久化授权(免每次重开授权)
- [ ] 文本文件 > 5 MiB 直接拒读(后续可改流式/分块读取)
- [ ] 平台验证:仅 Windows;macOS(sidecar 需签名公证)、Linux(WebKitGTK 编解码差,design.md §4 暂缓)未做
