# Observer — 任务清单(未完成项)

> 已完成内容见 [README.md](README.md) 的"当前进度"。本文档只登记**未做**的功能，按 design.md 的里程碑组织（框架层面的已知限制与 TODO 小项见 [framework.md](framework.md) §8）。架构已为每项留好接口（格式注册表 / Job 引擎占位 / 持久化层）。

## M3 — 音频进阶

- [ ] Tracker/Chiptune(mod/xm/s3m/it):libopenmpt —— `openmpt` crate 仅声明链接系统 libopenmpt(C 库),不捆绑源码,随包编译风险高,保持优雅占位(不破坏构建)。

## M5 — 格式转换

当前转换 frame 为"暂不可用"占位(架构已按 design.md §4 预留)。

- [ ] Job 引擎加 Convert 出口(与预览共用同一管道)
- [ ] FFmpeg 命令模板库(视频/音频转换)
- [ ] 图片编解码(解码 → image crate 编码 png/jpg/webp/tiff;AVIF 用 ravif)
- [ ] 3D 导出(three.js exporter GLB/STL/OBJ/PLY)
- [ ] 转换 frame UI:目标格式/参数选择、任务提交、进度显示

## 实测反馈

- 设置新增：文本类型增加默认字体大小，新打开的文本文件字体大小未默认字体大小