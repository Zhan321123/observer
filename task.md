# Observer — 任务清单(未完成项)

> 已完成内容见 [README.md](README.md) 的"当前进度"。本文档只登记**未做**的功能与已知限制,按 design.md §12 的里程碑组织。架构已为每项留好接口(格式注册表 / Job 引擎占位 / 持久化层)。

## M1 — 视频管道(已完成)

- [x] **视频缩略图接入 UI**:文件树视频行显示海报帧(`TreeThumb`,可见行懒加载);进度条悬停显示该时间点预览帧(`VideoSeekBar`,按秒分桶取帧 + 90ms 防抖)。后端 `video_thumbnail` 缓存 key 已修复(含 path+size+mtime+取帧秒,此前漏算 mtime/at 导致悬停撞缓存)。
- [x] **HDR → SDR 色调映射**(`zscale+tonemap=hable` → bt709):HDR 片源在转码分支叠加色调映射滤镜链;启动探测本机 ffmpeg 无 zscale/tonemap 时回退普通转码(可播但偏色,§4.2)。

## M2 — 图片解码 + 记录管理

持久化基础设施(SQLite)已完成;记录管理与图片解码(image/psd crate)本轮已做;RAW/HEIC 仍占位。

- [x] 记录管理界面(`RecordManagerDialog`):四类记录(预览历史/播放位置/文档位置/3D 视角)按类型分组、单条/勾选删除、按类型清空、一键清理失效(`history_purge_missing`)、保留策略(条数上限淘汰最旧 `history_apply_retention`,设置项 `historyRetention` 默认 500)。入口:设置 → 记录管理。
- [x] 文件失效检测接线:`history_open` 时 mtime/size 与记录不符 → 重置该文件的播放/滚动位置记录(历史保留并更新元信息);missing 灰显(顶栏历史 + 记录管理)。
- [x] 图片解码(image/psd crate):tiff/tif/tga/dds/qoi/hdr/exr(`image` crate)+ psd/psb(`psd` crate 合成图)→ 新 `decode_image` 命令磁盘缓存 PNG → `DecodedImageView`(经 `overrideSrc` 复用 ImageView 的缩放/平移/doc_position 持久化)。超大图按比例缩(>100MP)。
- [ ] 图片解码(剩余):RAW(`rawler`)、HEIC(`imazen/heic`)—— 依赖最重,后续里程碑。
- [ ] 图片 EXIF 摘要 / 色彩空间
- [ ] 图片缩略图管线:worker 池 + 磁盘缓存(视频缩略图命令已接入文件树;图片版 worker 池待做)

## M3 — 音频进阶

- [ ] MIDI(mid/midi):`rustysynth` SoundFont 合成 → PCM → Web Audio
- [ ] Tracker/Chiptune(mod/xm/s3m/it):libopenmpt
- [ ] 波形可视化:FFmpeg 抽 PCM 峰值 → 前端 canvas
- [ ] 非常规音频(ape/wv/tta/wma/aiff/dsf…)经 FFmpeg 流式解码(可复用 M1 的 loopback 流服务 + 前端音频视图)

## M4 — 3D / 动效 / 文档

Lottie 动画、PDF 查看器已完成;余下:

- [ ] 3D:three.js loaders(GLTF/GLB/OBJ/FBX/STL/PLY/DAE/3DS/3MF/PCD/BVH/VOX),滚轮缩放 + 拖动旋转;视角持久化(`threed_camera` 表已建);激活视口配额(截图降级)
- [ ] dotLottie(.lottie)/ Rive(.riv)/ SVGA(.svga)
- [ ] PDF 增强:页码/缩放位置持久化(`doc_position.page` 已预留)、文本层(选中复制 / 搜索)

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

- [ ] **SVG 源码模式滚轮冲突**:`ImageView` 的 wheel 监听挂在容器 DOM 上;切到源码模式时 React 复用同一 DOM 节点、effect(依赖 `[active, cellId, setView]`)不重跑,旧监听未摘除 → 源码模式下滚轮仍触发图片缩放且 `preventDefault` 挡住文本滚动。修复:wheel effect 依赖 `showSvgText`,源码模式下不挂/主动摘除监听,恢复文本滚动。
- [ ] **GIF 补图片式交互**:`GifView` 目前仅 canvas 居中自适应,格内无任何交互(`void active`)。补与 ImageView 一致的滚轮缩放(以鼠标为中心)+ 按住拖动平移,并接功能条缩放控件;帧控件保持现有。
- [ ] **PDF 格内交互**:`PdfView` 加左右各 1/3 宽度热区(光标分别显示 ←/→),点击=上一页/下一页;宫格、全窗、全屏行为一致。滚轮=缩放(以鼠标为中心),放大后按住拖动平移。现为功能条翻页/缩放,格内无交互。
- [ ] **图片边界可视**:图片(含 GIF / 解码图)缩放平移后边界不可辨,尤其透明/小图。给图像元素加 1px 描边/边框(随 transform 走),让用户看清边界。
- [ ] **适配类型对话框加搜索**:`SupportedTypesDialog` 加搜索框,按扩展名/描述过滤列表,匹配子串高亮。
- [ ] **记录管理与历史合并**:顶栏 `HistoryDialog` 与设置内 `RecordManagerDialog` 功能重叠(历史分组 vs 预览历史组)。合并为单一对话框/入口:以记录管理为壳,历史即其中一组,保留其余三类分组与全部操作;顶栏历史入口改为打开合并后的对话框。
