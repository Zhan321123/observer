import type { FileRef, FileKind } from "../types/file";
import type { FormatHandler, ResolvedPreview } from "./types";
import { imageHandler } from "./handlers/image";
import { videoHandler } from "./handlers/video";
import { audioHandler } from "./handlers/audio";
import { markdownHandler } from "./handlers/markdown";
import { spreadsheetHandler } from "./handlers/spreadsheet";
import { pdfHandler } from "./handlers/pdf";
import { threedHandler } from "./handlers/threed";
import { animHandler } from "./handlers/anim";
import { textHandler } from "./handlers/text";
import { PlaceholderView } from "../components/preview/PlaceholderView";

/**
 * 格式路由注册表(design.md §5②)。顺序即优先级。
 * 后续新增格式(Lottie/3D/RAW/HEIC…)= 加一个 handler 文件并在此登记一行。
 */
const handlers: FormatHandler[] = [
  imageHandler,
  videoHandler,
  audioHandler,
  markdownHandler,
  spreadsheetHandler,
  pdfHandler,
  threedHandler,
  animHandler,
  textHandler,
];

export function resolvePreview(file: FileRef): ResolvedPreview {
  for (const h of handlers) {
    if (h.canHandle(file)) return h.resolve(file);
  }
  return {
    kind: "unknown",
    strategy: "unsupported",
    component: PlaceholderView,
    reason: "暂不支持该格式",
  };
}

/** 文件树"可预览"过滤用 */
export function isPreviewableExt(ext: string): boolean {
  const e = ext.toLowerCase();
  return handlers.some((h) => h.exts.includes(e));
}

/** 由扩展名同步推导 kind(与 handlers 同序,单一事实来源;与 Rust kind_for_ext 一致) */
export function kindForExt(ext: string): FileKind {
  const e = ext.toLowerCase();
  for (const h of handlers) if (h.exts.includes(e)) return h.name as FileKind;
  return "unknown";
}

/** "适配类型"对话框用:各 handler 的 name + 扩展名清单(按优先级序) */
export function supportedTypes(): { name: string; exts: string[] }[] {
  return handlers.map((h) => ({ name: h.name, exts: h.exts }));
}
