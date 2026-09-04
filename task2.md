# Observer — 候选格式支持清单(task2)

> 承接 [task.md](task.md)(未完成里程碑)之外的新格式候选,按接入成本分档。每项标注:文件类型说明、接入管道(native 前端库 / decode-rust / ffmpeg-stream / archive 双身份容器)、推荐库。架构不变:加一个格式 = 加一个 handler 文件 + registry.ts 登记一行(design.md §5②)。

## 二、低成本高价值(纯前端库,走 native 策略)

- [ ] **EPUB 渲染**(电子书,zip 容器)— epub.js 阅读器;双身份切换"目录树/阅读器"
- [ ] **Hex 视图(兜底)**(任意未知二进制)— 十六进制 + ASCII 对照预览;前端或 Rust 均可
- [ ] **字幕 srt/vtt/ass**(影视字幕:SubRip / WebVTT / Advanced SubStation Alpha)— 前端解析时间轴 + 文本列表;ass 可用 libass-wasm 真渲染样式特效
- [ ] **GLB 的 Draco/KTX2 压缩补强**(Draco 网格压缩 / KTX2 纹理压缩的 glTF 二进制)— three.js DRACOLoader + KTX2Loader(需带 draco/ktx2 wasm 资产);线上大量 GLB 是压缩的,当前会加载失败,属于对现有 3D 支持的修复性补强

## 三、中成本

- [ ] **JXL(JPEG XL,新一代 JPEG 替代格式)** — jxl-oxide(纯 Rust)→ decode-rust 管道 → PNG 磁盘缓存;Chromium 不原生支持,正好补空白
- [ ] **XCF(GIMP 源文件,含图层的分层图像)** — xcf crate(纯 Rust)→ decode-rust 管道
- [ ] **WMF/EMF**(Windows 图元文件,Office 剪贴画常用的矢量格式)— windows crate GDI+ 渲染转 PNG → decode-rust 管道;Windows 特有,与首发平台契合
- [ ] **CHM**(编译版 HTML 帮助文件,老 Windows 软件/电子书常见)— chmlib 系 Rust 绑定,解 ITS 存储 → 渲染内嵌页面
- [ ] **IPYNB(Jupyter Notebook,数据科学代码+输出文档)** — 前端渲染器:代码块高亮 + 输出(含图片/base64)分块展示
- [ ] **MHT/MHTML**(单文件网页,浏览器"另存为"产物,把 HTML+资源打包成 MIME)— WebView blob 渲染
- [ ] **EML**(标准邮件文件,Outlook/Foxmail 导出的 MIME 报文)— 前端 MIME 解析:正文 + 附件列表
- [ ] **MOBI/AZW3**(Kindle 电子书)— mobi crate(纯 Rust)→ 提取文本/封面渲染
- [ ] **WRL(VRML,早期 Web 3D 场景描述)** — three.js VRMLLoader,同上
- [ ] **torrent**(BitTorrent 种子文件,bencode 编码)— bencode 解析 → 文件列表表格,体验对齐压缩包目录树
- [ ] **NFO**(老派 warez/演示场景信息文件,CP437 编码的 ASCII art)— CP437 解码(decodeText 已有编码检测基建)+ 等宽字体展示
- [ ] **GeoJSON / GPX / KML**(地理数据:GPS 轨迹 / 地图标注 / Google Earth)— canvas 折线绘制(无底图,离线友好)或 leaflet(需在线瓦片)

## 四、已有挂起项的出路

- [ ] **Tracker/Chiptune mod/xm/s3m/it**(Amiga 时代音轨模块,chiptune 音乐)— task.md M3 挂起原因是 libopenmpt 为 C 库;**libopenmpt 官方有 WASM 构建(libopenmpt.js)**,可在 WebView 内解码播放,绕开随包编译风险
- [ ] 参考同类风险: DjVu(扫描版电子书,djvulibre 为 C 库)、NSF/SPC(游戏机音频,需模拟器内核)仍建议保持占位
