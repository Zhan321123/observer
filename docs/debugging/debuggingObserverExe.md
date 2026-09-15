# 调试 Observer 打包版（observer.exe）行为关键事实：

1. **tauri.conf.json 的 CSP 只在打包版生效**（前端走 `http://tauri.localhost` 内嵌资源时注入）；`pnpm dev` 走 Vite（localhost:5173）无 CSP。所以「dev 正常、打包后失败」优先怀疑 CSP。2026-09-10 修了两处：`script-src` 加 `'wasm-unsafe-eval'`（否则拦截一切 WASM：meshopt GLB、dotlottie）；`connect-src` 加 `blob:`（否则 GLTFLoader 内嵌贴图的 `fetch(blob:)` 被拦→模型白色无贴图；SVGA 的 XHR blob 同样被拦）。注意 `img-src`/`media-src` 早有 `blob:`，唯独 connect-src 漏了——三个 directive 要分别允许。

2. **不要用裸 `cargo build --release` 验证打包行为**：tauri-build 在没有 tauri CLI 设置的 `TAURI_ENV_*` 环境变量时会把 `dev` cfg 编进去——二进制会去加载 devUrl（localhost:5173）而不是内嵌资源，且体积明显更小。验证打包行为必须走 `pnpm build`（tauri CLI）。

3. **WebView2 远程调试**：`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9222" observer.exe` 启动，然后用 node（内置 WebSocket）连 `ws://127.0.0.1:9222/devtools/page/<id>` 跑 Runtime.evaluate/Page.captureScreenshot。注意：dev 与 release 的 WebView2 共用同一 user data folder（同 identifier），会进同一 browser process——选 target 时要按 URL 过滤（`http://tauri.localhost/`），别取第一个 page。改 CSP 需重编 Rust（配置编译进二进制）。
