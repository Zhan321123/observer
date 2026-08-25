# Observer

一个"预览尽可能多种类文件"的桌面应用(形态参考 macOS Quick Look / PowerToys Peek),支持宫格多文件同时预览。当前版本覆盖**图片(原生 + TIFF/PSD/RAW/HEIC 解码)、文本/代码/Markdown、音视频(原生 + FFmpeg 流式)、Lottie、PDF、电子表格**的快速预览;更多格式(3D、格式转换等)按里程碑逐步接入,见 [task.md](task.md)。

> 设计文档:[docs/design.md](docs/design.md)(技术架构)· [docs/layout.md](docs/layout.md)(界面交互)· [docs/method.md](docs/method.md)(格式→库 映射)

## 技术栈

- **后端 / 壳**:Tauri 2(Rust)+ 系统 WebView
- **前端**:Vite + React 19 + TypeScript + Tailwind CSS v4 + zustand + react-resizable-panels v4
- **关键铁律**:媒体字节走 `asset://` 协议(`convertFileSrc`),不走 invoke IPC;IPC 只传元数据/文本。格式路由采用注册表,加一个格式 = 加一个 handler 文件。

## 目录结构

```
observer/
├── docs/                设计文档(design / layout / method)
├── observer.png         logo 源文件
├── observer-react/      前端(Vite + React)
│   └── src/
│       ├── components/  六区布局 + 各预览组件
│       ├── formats/     格式路由注册表(handlers/)
│       ├── stores/      zustand:宫格 / 文件夹 / 设置 / 视图态 / 控制
│       ├── lib/         IPC 出口、格式化、代码高亮
│       └── hooks/       OS 拖入等
└── observer-tauri/      后端(Tauri 2 crate,自带最小 package.json 装 CLI)
    ├── src/             main / lib / commands / formats
    ├── capabilities/    权限
    └── icons/           `pnpm tauri icon` 生成
```

## 环境构建

**必需环境(Windows 首发):**

| 工具 | 版本(本机已验证) | 说明 |
|---|---|---|
| Node.js | v24.13.0 | |
| pnpm | 9.15.9 | 统一用 pnpm,不要混用 npm/yarn |
| Rust | 1.97.0 | target `x86_64-pc-windows-msvc` |
| Visual Studio Build Tools | — | 需 "C++ 生成工具" 工作负载(MSVC 链接器) |
| WebView2 Runtime | — | Windows 11 已内置 |

> Tauri CLI **不需要全局安装**;它作为 npm devDependency(`@tauri-apps/cli`)装在 `observer-tauri/` 里,通过 `pnpm tauri …` 调用。

**首次安装依赖:**

```bash
# 前端依赖
cd observer-react
pnpm install

# 后端依赖(@tauri-apps/cli)
cd ../observer-tauri
pnpm install
```

**(可选)重新生成应用图标:** 图标已从 `observer.png` 生成并提交在 `observer-tauri/icons/`。如需重做:

```bash
cd observer-tauri
pnpm tauri icon ../observer.png
```

## 项目启动(开发)

单命令即可(`beforeDevCommand` 会自动拉起前端 Vite 开发服务器):

```bash
cd observer-tauri
pnpm dev
```

- 首次运行会编译全部 Rust 依赖,需几分钟;之后为增量编译。
- 前端改动热更新;改动 Rust 源码会触发重新编译并重启应用。
- 默认打开**桌面**文件夹,宫格默认 1×1。

> 前端也可单独起(仅供浏览器调试,但无 Tauri 能力):`cd observer-react && pnpm dev`

## 项目打包(发布)

```bash
cd observer-tauri
pnpm build
```

流程:`beforeBuildCommand` 先跑前端 `tsc --noEmit && vite build` 产出 `observer-react/dist`,再 cargo release 编译并打包。Windows 安装包输出在:

```
observer-tauri/target/release/bundle/{nsis,msi}/
```

## 当前进度

- 六区可调布局(文件树 / 预览宫格 / 文件信息 / 功能条 / 格式转换占位 / 顶栏)
- 宫格:m×n(最大 9×9)选择器、选中/关闭/单格展示、格间拖拽、OS 拖入、缩容保留左上子矩阵、**占满覆盖策略(选中/第一格/依次)**、**标题栏刷新重读**
- 预览:原生图片(滚轮缩放+拖拽平移)、文本/代码/Markdown(高亮+渲染,**行号/自动换行/复制全文/Ctrl+滚轮调字号**)、原生音视频(自制控制条)
- 文件树:树形展开/折叠 + 虚拟滚动;文件行按类别显示细致图标(图片/视频/音频/表格/文档…分色)
- **FFmpeg 视频管道(M1)**:mkv/ts/mov/wmv/flv/avi/hevc 等经 loopback HTTP 流式预览(remux 优先,否则实时转码 H.264+AAC),seek 改 `-ss` 重启;B 站 `video.m4s+audio.m4s` 双输入合并;ffprobe 元信息填充文件信息框
- **图片解码(M2)**:tiff/tga/exr/dds/qoi/hdr/psd(image/psd crate)+ RAW(cr2/nef/arw/dng 等,rawler 纯 Rust)+ HEIC/HEIF(heic crate)→ 磁盘缓存 PNG 预览;图片 EXIF 摘要/色彩空间(exifr)
- **音频进阶(M3)**:ape/wv/tta/wma/aiff/dsf 等经 loopback 流式预览(FFmpeg 转 AAC fMP4);音频波形可视化(FFmpeg 抽 PCM 峰值 → canvas,点击/拖动 seek);MIDI 经 rustysynth SoundFont 合成 → WAV 原生播放(需用户提供 .sf2)
- 功能条按类型切换;在资源管理器显示、复制路径可用;**三处右键菜单(资源管理器打开/复制路径)**;打开的文件列表可单格关闭;全界面/全屏显示(Esc/F11 退出)
- 格式识别:扩展名初筛 + 魔数嗅探(ftyp/RIFF/OggS/fLaC/Lottie 五件套等)
- 文件信息框:名称/格式/大小/修改时间/可复制路径/图片分辨率/**视频音频 ffprobe 元信息**
- **持久化(M2 SQLite)**:预览历史(顶栏"历史"可查看/单删/清空)、宫格全景(布局+各格文件+选中格)、当前文件夹、设置项、播放进度/文本滚动/图片缩放 —— 重启后整体恢复

未完成项与后续里程碑见 [task.md](task.md)。
