# Obverser — 格式方法表（什么格式用什么库/方法）

> 版本：v0.1（2026-08-22）
> 关联文档：[design.md](design.md)（技术架构）· [layout.md](layout.md)（界面与交互）
> 本文档是"格式 → 识别方法 → 预览方案 → 库"的单一索引，新增格式时在此登记。

## 1. 总览路由

```
文件 → 格式识别（§2）
  ├─ 视频   → §3（四级兜底：直放 → remux → 转码 → HDR）
  ├─ 音频   → §4（FFmpeg / rustysynth / libopenmpt）
  ├─ 图片   → §5（WebView 原生 / image / rawler / heic / psd / resvg）
  ├─ 3D     → §6（three.js loaders）
  ├─ 动效   → §7（lottie-web / dotlottie / rive / svga）
  └─ 文档/其他 → §7（pdf.js / 高亮 / FontFace）
```

## 2. 格式识别

两级识别，**不看扩展名下结论**：

1. **扩展名初筛**：快速路由常见格式
2. **魔数/结构嗅探**（拿不准时读文件头）：

| 目标 | 嗅探方法 |
|---|---|
| mp4/m4s/mov | offset 4 起 `ftyp` box（m4s 即分片 MP4，同构） |
| Lottie 动画 | JSON 解析前部字段：`v + fr + ip + op + layers` 五件套命中 → Lottie，否则走文本 |
| RIFF/AIFF/Ogg/FLAC 等音频容器 | 各自魔数（`RIFF`/`FORM`/`OggS`/`fLaC`） |
| dotLottie(.lottie)/3MF/Office | ZIP 魔数 + 内部结构（`.lottie` 含 manifest） |

**B 站缓存特例**：同目录成对的 `video.m4s` + `audio.m4s` → FFmpeg 双输入合并（`-i video.m4s -i audio.m4s`），否则单放无声。

## 3. 视频

FFmpeg（sidecar）demux+decode 全覆盖：mkv/ts/m2ts/mts/m4s/mp4/mov/wmv/asf/flv/vob/rm/rmvb/3gp/y4m/webm/avi…

| 级别 | 情况 | 方法 | 体验 |
|---|---|---|---|
| 1 | 容器+编码 WebView 直接认（mp4/webm 等） | `asset://` / `convertFileSrc` 直接流式（内置 Range） | 秒开 |
| 2 | 编码是 H.264/AAC 但容器不认（多数 mkv、m4s、ts） | FFmpeg **remux**：`-c copy` 只换封装不解码，CPU≈0 | 秒开 |
| 3 | 编码不认（wmv/rmvb/HEVC→无扩展的机器） | FFmpeg 实时转码 H.264+AAC 流，边转边播 | 近秒开 |
| 4 | HDR 片源 | 转码叠加 `zscale+tonemap` filter 转 SDR | 近秒开 |

- seek：转码流不能原生 seek，杀旧进程带 `-ss <t>` 重启
- 缩略图/预览雪碧图：`ffmpeg -fps 1/10 + tile` filter
- 元信息：ffprobe（编码/时长/码率/HDR 标识，喂 layout.md §6 文件信息 frame）

## 4. 音频

| 类别 | 格式 | 库/方法 |
|---|---|---|
| 常规有损/无损 | flac/ape/wv/tta/m4a/ogg/opus/wma/aiff/dsf/dff | FFmpeg → AAC 流或 PCM |
| MIDI | mid/midi | **[rustysynth](https://lib.rs/crates/rustysynth)**（纯 Rust SoundFont 合成）→ PCM → Web Audio |
| Tracker/Chiptune | mod/xm/s3m/it | libopenmpt（openmpt-sys 绑定）或前端 wasm |
| 波形可视化 | 全部 | FFmpeg 抽 PCM 峰值 → 前端 canvas |

注：FFmpeg 不支持 MIDI 是其罕见盲区，rustysynth 恰好补上（Node 生态无等价物）。

## 5. 图片

| 类别 | 格式 | 库/方法 | 备注 |
|---|---|---|---|
| WebView 原生 | png/jpg/gif/webp/avif/svg/bmp/ico | 直接显示 | 零成本 |
| 常规扩展 | tiff/tga/dds/qoi/hdr/exr | [image](https://crates.io/crates/image) crate → PNG/WebP | 纯 Rust |
| RAW | cr2/cr3/nef/arw/orf/rw2/dng/raf… | **[rawler](https://github.com/dnglab/dnglab)**（dnglab）；备选 [zenraw](https://github.com/imazen/zenraw) | 快路径：先抽内嵌 JPEG 秒开，后台再全尺寸 |
| HEIC | heic/heif | [imazen/heic](https://github.com/imazen/heic-decoder-rs)（纯 Rust）；备选 [libheif-rs](https://crates.io/crates/libheif-rs) | 全系最麻烦依赖 |
| PSD | psd/psb | [psd](https://crates.io/crates/psd) crate 取合成图；FFmpeg 亦内置 PSD 解码 | |
| SVG 栅格化 | svg | [resvg](https://crates.io/crates/resvg) + tiny-skia + fontdb | WebView 直接显示外的备选 |
| 字体 | ttf/otf/woff2 | 前端 FontFace API 渲染字样 | 纯前端 |

- 缩略图：磁盘缓存（key = 路径+mtime+size），worker 池生成
- 大图（GB 级 PSD/TIFF）：分块读、流式解码，缩略图可 mmap

## 6. 3D

WebView WebGL 渲染，与 Electron 零差距。[three.js loaders](https://mcpmarket.com/tools/skills/three-js-asset-loaders)（或 `<model-viewer>` Web Component）：

| 覆盖度 | 格式 |
|---|---|
| 开箱即用 | GLTF/GLB（含 Draco/KTX2/Meshopt、骨骼动画）、OBJ+MTL、FBX、STL、PLY、DAE、3DS、3MF、PCD、BVH、VOX |
| 部分支持 | USDZ（材质复杂时丢东西） |
| 远期目标 | STEP/IGES/3DM（CAD，需 OpenCascade 级依赖，不碰首期） |

## 7. 动效与文档

| 格式 | 文件 | 库/方法 |
|---|---|---|
| Lottie | .json（§2 嗅探识别） | [lottie-web](https://github.com/airbnb/lottie-web)（纯矢量用 svg renderer，复杂动画用 canvas） |
| dotLottie | .lottie（zip） | @lottiefiles/dotlottie-web |
| Rive | .riv | @rive-app/canvas |
| SVGA | .svga | svga-player |
| PDF | .pdf | pdf.js |
| 代码/文本/markdown | — | 语法高亮 + markdown 渲染 |

## 8. 转换方法预留（未来，M5）

| 类别 | 方法 |
|---|---|
| 视频/音频 | FFmpeg 命令模板库（与预览同一 sidecar） |
| 图片 | rawler/image/heic 解码 → image crate 编码（png/jpg/webp/tiff；AVIF 编码用 ravif） |
| 3D | 前端 three.js exporter（GLB/STL/OBJ/PLY）先行；重量级（FBX→glTF 带动画）上 Rust 侧 assimp（russimp） |

## 参考资料

- [rawler (dnglab)](https://github.com/dnglab/dnglab) · [zenraw](https://github.com/imazen/zenraw) · [imazen/heic](https://github.com/imazen/heic-decoder-rs) · [libheif-rs](https://crates.io/crates/libheif-rs)
- [image](https://crates.io/crates/image) · [psd](https://crates.io/crates/psd) · [resvg](https://crates.io/crates/resvg)
- [three.js loaders](https://mcpmarket.com/tools/skills/three-js-asset-loaders) · [vextrude 3D 转换器](https://vextrude.com/3d-converter) · [next3d 格式列表](https://next3d.ai/viewer)
- [rustysynth](https://lib.rs/crates/rustysynth) · [lottie-web](https://github.com/airbnb/lottie-web)
