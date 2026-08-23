import type { FormatHandler } from "../types";
import { ImageView } from "../../components/preview/ImageView";
import { GifView } from "../../components/preview/GifView";
import { IcoView } from "../../components/preview/IcoView";
import { PlaceholderView } from "../../components/preview/PlaceholderView";

// WebView 原生可显示的图片;RAW/HEIC/PSD/TIFF 等列入 exts(让树里可见)但走 decode-rust 占位(M2)。
// gif / ico 分流到专用组件(gif 逐帧、ico 多尺寸,§第二批)。
const NATIVE = ["png", "jpg", "jpeg", "webp", "svg", "bmp", "avif"];
const DECODE_LATER = ["tiff", "tif", "tga", "dds", "qoi", "hdr", "exr", "heic", "heif", "psd", "psb", "cr2", "cr3", "nef", "arw", "orf", "rw2", "dng", "raf"];

export const imageHandler: FormatHandler = {
  name: "image",
  exts: [...NATIVE, "gif", "ico", ...DECODE_LATER],
  canHandle: (f) => f.kind === "image",
  resolve: (f) => {
    if (f.ext === "gif") return { kind: "image", strategy: "native", component: GifView };
    if (f.ext === "ico") return { kind: "image", strategy: "native", component: IcoView };
    if (NATIVE.includes(f.ext)) return { kind: "image", strategy: "native", component: ImageView };
    return {
      kind: "image",
      strategy: "decode-rust",
      component: PlaceholderView,
      reason: "该图片格式需 Rust 解码库(RAW/HEIC/PSD/TIFF 等,后续里程碑 M2)",
    };
  },
};
