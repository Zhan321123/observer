import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Tauri 期望一个明确的开发端口,且不要清空屏幕以便同时看到 Rust 日志
export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    watch: { ignored: ["**/observer-tauri/**"] },
  },
  envPrefix: ["VITE_", "TAURI_"],
  build: {
    // WebView2(Chromium)+ WKWebView(Safari)双内核下限
    target: ["es2021", "chrome105", "safari13"],
    outDir: "dist",
    chunkSizeWarningLimit: 1000,
  },
});
