import type { FormatHandler } from "../types";
import { FontView } from "../../components/preview/FontView";

// task2 二:字体(ttf/otf/woff/woff2/ttc)→ FontFace 样张 + 试字输入;
// 字形表/元数据走 opentype.js(woff2/ttc 解不了则降级提示)。
export const fontHandler: FormatHandler = {
  name: "font",
  exts: ["ttf", "otf", "woff", "woff2", "ttc"],
  canHandle: (f) => f.kind === "font",
  resolve: () => ({ kind: "font", strategy: "native", component: FontView }),
};
