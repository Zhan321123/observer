# Observer — 任务清单(未完成项)

> 已完成内容见 [README.md](README.md) 的"当前进度"。本文档只登记**未做**的功能与已知限制,按 design.md §12 的里程碑组织。架构已为每项留好接口(格式注册表 / Job 引擎占位 / 持久化层)。

## M3 — 音频进阶

- [ ] Tracker/Chiptune(mod/xm/s3m/it):libopenmpt —— `openmpt` crate 仅声明链接系统 libopenmpt(C 库),不捆绑源码,随包编译风险高,保持优雅占位(不破坏构建)。

## M5 — 格式转换

当前转换 frame 为"暂不可用"占位(架构已按 design.md §10 预留)。

- [ ] Job 引擎加 Convert 出口(与预览共用同一管道)
- [ ] FFmpeg 命令模板库(视频/音频转换)
- [ ] 图片编解码(解码 → image crate 编码 png/jpg/webp/tiff;AVIF 用 ravif)
- [ ] 3D 导出(three.js exporter GLB/STL/OBJ/PLY)
- [ ] 转换 frame UI:目标格式/参数选择、任务提交、进度显示

## 当前版本已知限制 / TODO(小项)

- [ ] **`dragDropEnabled=true` 与页面内 HTML5 DnD 互斥**(Tauri 限制):为让 OS 拖入能拿到绝对路径必须开 `dragDropEnabled`,代价是页面内 HTML5 拖放被禁用,故内部拖拽改用 pointer 事件自实现(`lib/pointerDrag.ts`)。参考:[tauri#9421](https://github.com/tauri-apps/tauri/issues/9421)。
- [ ] asset 协议 scope 为宽放行(`**/*`)+ 运行时授权;对外分发前应收紧,并考虑 `tauri-plugin-persisted-scope` 持久化授权(免每次重开授权)
- [ ] 超大文本(GiB 级)一次性读入渲染(现有 10MB 阈值 + 确认门槛,后端 1 GiB 护栏;真正的流式/分块渲染未做)
- [ ] 平台验证:仅 Windows;macOS(sidecar 需签名公证)、Linux(WebKitGTK 编解码差,design.md §4 暂缓)未做
- [ ] FFmpeg 随包分发:当前依赖 PATH/环境变量;打包需 externalBin 放置二进制并处理许可(LGPL 解码构建 vs 本机 GPL 含 x264)
