# Observer — 任务清单(未完成项)

> 已完成内容见 [README.md](README.md) 的"当前进度"。本文档只登记**未做**的功能与已知限制,按 design.md §12 的里程碑组织。架构已为每项留好接口(格式注册表 / Job 引擎占位 / 持久化层)。

## M1 — 视频管道(已完成)

- [x] **视频进度条悬停预览**:进度条悬停显示该时间点预览帧(`VideoSeekBar`,按秒分桶取帧 + 90ms 防抖,`video_thumbnail` 磁盘缓存)。缓存 key 已修复(含 path+size+mtime+取帧秒,此前漏算 mtime/at 导致悬停撞缓存)。(文件树行内海报帧后按实测反馈取消,见文末交互修正。)
- [x] **HDR → SDR 色调映射**(`zscale+tonemap=hable` → bt709):HDR 片源在转码分支叠加色调映射滤镜链;启动探测本机 ffmpeg 无 zscale/tonemap 时回退普通转码(可播但偏色,§4.2)。

## M2 — 图片解码 + 记录管理

持久化基础设施(SQLite)、记录管理、图片解码(image/psd/rawler/heic crate)、EXIF 摘要本轮均已做。

- [x] 记录管理界面(`RecordManagerDialog`):四类记录(预览历史/播放位置/文档位置/3D 视角)按类型分组、单条/勾选删除、按类型清空、一键清理失效(`history_purge_missing`)、保留策略(条数上限淘汰最旧 `history_apply_retention`,设置项 `historyRetention` 默认 500)。入口:设置 → 记录管理。
- [x] 文件失效检测接线:`history_open` 时 mtime/size 与记录不符 → 重置该文件的播放/滚动位置记录(历史保留并更新元信息);missing 灰显(顶栏历史 + 记录管理)。
- [x] 图片解码(image/psd crate):tiff/tif/tga/dds/qoi/hdr/exr(`image` crate)+ psd/psb(`psd` crate 合成图)→ 新 `decode_image` 命令磁盘缓存 PNG → `DecodedImageView`(经 `overrideSrc` 复用 ImageView 的缩放/平移/doc_position 持久化)。超大图按比例缩(>100MP)。
- [x] 图片解码(剩余):RAW(cr2/cr3/nef/arw/orf/rw2/dng/raf,`rawler` 纯 Rust demosaic+显影 sRGB)、HEIC/HEIF(`heic` crate 纯 Rust HEVC)→ 复用 `decode_image` 磁盘缓存 + `DecodedImageView`。均纯 Rust 无 C 依赖,随包可编译。
- [x] 图片 EXIF 摘要 / 色彩空间:前端 `exifr` 解析(`lib/exif.ts`),`FileInfoPanel` 显示 相机/镜头/曝光(快门·光圈·ISO·焦距)/色彩空间/拍摄时间;无 EXIF 显示"无 EXIF 信息"。

## M3 — 音频进阶

- [x] MIDI(mid/midi):`rustysynth` SoundFont 合成 → 交错 PCM → `hound` 写 16-bit 立体声 WAV 磁盘缓存(新 `midi_render` 命令,缓存 key 含 SoundFont 标识,换 SoundFont 自动重渲染)→ 前端 `MidiView` 用原生 `<audio>` 播放(天然可 seek),进度/音量持久化按原 mid 路径。SoundFont 不随包捆绑(体积/许可),按 env `OBSERVER_SOUNDFONT` → 应用目录 `soundfont.sf2` 发现;无 .sf2 时显示明确占位提示。
- [ ] Tracker/Chiptune(mod/xm/s3m/it):libopenmpt —— `openmpt` crate 仅声明链接系统 libopenmpt(C 库),不捆绑源码,随包编译风险高,本轮保持优雅占位(不破坏构建)。
- [x] 波形可视化:新 `audio_waveform` 命令(FFmpeg 解码 → 单声道 8k s16 → 分桶 min/max 峰值,默认 1000 桶,归一化 ±1)→ 前端 `Waveform`(canvas 画上下包络,已播/未播分色 + 播放头,点击/拖动 seek);接入原生音频(`MediaCore` 音频分支替掉 range 进度条)与流式音频(`StreamAudioView`)。
- [x] 非常规音频(ape/wv/tta/wma/aiff/aif/dsf/dff)经 FFmpeg 流式解码:复用 M1 loopback `/stream`(FFmpeg demux/decode → AAC fMP4),纯音频流转码时 Content-Type 修正为 `audio/mp4`;新 `StreamAudioView`(seek=改 t 重启流,波形可视 + 进度/音量/倍速持久化)。

## M4 — 3D / 动效 / 文档

Lottie 动画、PDF 查看器已完成;余下:

- [ ] 3D:three.js loaders(GLTF/GLB/OBJ/FBX/STL/PLY/DAE/3DS/3MF/PCD/BVH/VOX),滚轮缩放 + 拖动旋转;视角持久化(`threed_camera` 表已建);激活视口配额(截图降级)
- [ ] dotLottie(.lottie)/ Rive(.riv)/ SVGA(.svga)
- [ ] PDF 增强:页码/缩放位置持久化(`doc_position.page` 已预留)

## M5 — 格式转换

当前转换 frame 为"暂不可用"占位(架构已按 design.md §10 预留)。

- [ ] Job 引擎加 Convert 出口(与预览共用同一管道)
- [ ] FFmpeg 命令模板库(视频/音频转换)
- [ ] 图片编解码(解码 → image crate 编码 png/jpg/webp/tiff;AVIF 用 ravif)
- [ ] 3D 导出(three.js exporter GLB/STL/OBJ/PLY)
- [ ] 转换 frame UI:目标格式/参数选择、任务提交、进度显示

## 当前版本已知限制 / TODO(小项)

- [ ] **`dragDropEnabled=true` 与页面内 HTML5 DnD 互斥**(Tauri 限制):为让 OS 拖入能拿到绝对路径必须开 `dragDropEnabled`,代价是页面内 HTML5 拖放被禁用,故内部拖拽改用 pointer 事件自实现(`lib/pointerDrag.ts`)。参考:[tauri#9421](https://github.com/tauri-apps/tauri/issues/9421)。
- [x] **资源配额强制执行(流媒体路数)**:新增 `useMediaQuota` 响应式订阅 cellViewStore,播放中的视频+音频路数超 `mediaQuota` 时,按 `lastPlayAt`(起播时间戳)暂停最久未起播的一路,被暂停格保留进度。~~3D 视口降级为截图~~ 留待 M4(3D 未实现)。
- [x] 文件树虚拟滚动:引入 `@tanstack/react-virtual`,展开树扁平化为可见行后 `useVirtualizer` 渲染(行高 24px,overscan 12),大目录不卡。
- [x] 窗口尺寸 / 树展开状态重启保留:`app_state` 新增 `window`(LogicalSize,resize 防抖写回,bootstrap `setSize` 还原)与 `treeExpanded`(展开路径集合,`folderStore.getExpandedPaths/applyExpandedPaths` 序列化/还原)。
- [x] 图片全屏切换平移保留:free 模式的 x/y/s 改经 cellViewStore 瞬态接力(全屏切换不清 views,同步读取无 IPC 竞态),doc_position 仅作重启兜底;自动适配模式仍在全屏大容器重算自适应。
- [x] 视频逐帧精确步长:改用 `1/ffprobe frame_rate`(未知回退 1/30);`StreamVideoView.stepFrame` 补暂停步进。(VFR 片源 r_frame_rate 为名义帧率,真·逐帧需 show_frames,暂不追求)
- [x] markdown 渲染加 DOMPurify:`md.render()` 输出经 `DOMPurify.sanitize()` 注入(md 已 `html:false`,此为纵深防御)。
- [ ] asset 协议 scope 为宽放行(`**/*`)+ 运行时授权;对外分发前应收紧,并考虑 `tauri-plugin-persisted-scope` 持久化授权(免每次重开授权)
- [ ] 超大文本(GiB 级)一次性读入渲染(现有 10MB 阈值 + 确认门槛,后端 1 GiB 护栏;真正的流式/分块渲染未做)
- [ ] 平台验证:仅 Windows;macOS(sidecar 需签名公证)、Linux(WebKitGTK 编解码差,design.md §4 暂缓)未做
- [ ] FFmpeg 随包分发:当前依赖 PATH/环境变量;打包需 externalBin 放置二进制并处理许可(LGPL 解码构建 vs 本机 GPL 含 x264)

## 交互修正(实测反馈)

- [x] **SVG 源码模式滚轮冲突**:`ImageView` 滚轮缩放 effect 改依赖 `showSvgText`,源码模式下不挂监听(并随 effect 重跑摘除旧监听),恢复文本滚动;切回预览再挂上。此前旧监听挂在被 React 复用的容器 DOM 上,`preventDefault` 挡住文本滚动且误触图片缩放。
- [x] **GIF 补图片式交互**:`GifView` 改 transform 模型(对齐 ImageView):滚轮以鼠标为中心缩放 + 按住拖动平移(pointer capture),新增 best-fit/actual/free 三态并接功能条"最佳显示/1:1/缩放条"控件(功能条缩放组条件放开到 gif);顺带补注册 `toggleTransparencyGrid`(此前 gif 透明网格按钮空挂)。缩放/平移经 cellViewStore 瞬态接力,全屏切换保留;帧控件保持现有。
- [x] **PDF 格内交互**:`PdfView` 改 transform 模型:滚轮=以鼠标为中心缩放(交互期只动 transform 保流畅,去抖 180ms 按当前倍率重渲染画布保清晰不跳变,渲染分辨率上限 4× 防超大画布);放大后按住拖动=平移(6px 阈值区分点击/拖拽);左右各 1/3 热区点击=上一页/下一页,光标为自定义 SVG ←/→(黑描边白箭头,w/e-resize 兜底);宫格/全窗/全屏行为一致(`active` 时生效)。载入/翻页 best-fit 居中,手动缩放后仅重新居中。
- [x] **图片边界可视**:图片(`ImageView`,含 SVG 与 `DecodedImageView` 解码图)与 GIF canvas 缩放平移后加 1px 双色描边(深外浅内 box-shadow 环,任意底色可辨)。用独立 overlay(自身不带 transform)按图像屏幕矩形定位,线宽恒为屏幕 1px,不随倍率变粗。
- [x] **适配类型对话框加搜索**:`SupportedTypesDialog` 加搜索框(autoFocus),按扩展名 / 类别描述(中文 label + 英文 name)过滤,类别命中整组保留,匹配子串 `<mark>` 高亮;无匹配显示空态。
- [x] **记录管理与历史合并**:删除 `HistoryDialog`,顶栏「历史」改为打开合并后的 `RecordManagerDialog`(以记录管理为壳,历史即其中一组,保留其余三类分组与全部操作);「预览历史」组补回点击重开(进首空格,失效灰显不可点),设置 → 记录管理入口不变。
- [x] **文件树行内缩略图改为类别图标**:取消文件树视频海报帧 / 图片缩略图位图(连带删除 `TreeThumb`、后端 `image_thumbnail` 命令及 image crate 的 jpeg/webp/gif/bmp 缩略图特性),文件行改为按类别显示细致 lucide 图标 + 配色(图片 violet / 视频 sky / 音频 rose / 表格 emerald / PDF red / Markdown indigo / 文本灰),树更轻、类型一目了然;视频进度条悬停预览帧(`VideoSeekBar`)不受影响。
