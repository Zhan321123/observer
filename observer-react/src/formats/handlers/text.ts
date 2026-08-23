import type { FormatHandler } from "../types";
import { TextView } from "../../components/preview/TextView";

// 代码 / 纯文本。注意:.json 可能是 Lottie 动效(§2 嗅探),本轮按文本处理,后续在 detect_format 嗅探后分流。
export const textHandler: FormatHandler = {
  name: "text",
  exts: [
    "txt", "json", "js", "mjs", "cjs", "ts", "tsx", "jsx", "rs", "py", "css", "scss", "less",
    "html", "htm", "xml", "yml", "yaml", "toml", "ini", "conf", "cfg", "log", "csv", "tsv",
    "c", "h", "cpp", "cc", "hpp", "cs", "java", "go", "sh", "bash", "bat", "ps1", "sql",
    "vue", "svelte", "lock", "gitignore", "env", "svg" /* svg 已由 image 优先处理 */,
  ],
  canHandle: (f) => f.kind === "text",
  resolve: () => ({ kind: "text", strategy: "native", component: TextView }),
};
