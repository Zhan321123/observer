import type { FormatHandler } from "../types";
import { ImageView } from "../../components/preview/ImageView";
import { PlaceholderView } from "../../components/preview/PlaceholderView";

// WebView 原生可显示的图片;RAW/HEIC/PSD/TIFF 等列入 exts(让树里可见)但走 decode-rust 占位(M2)。
const NATIVE = ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico", "avif"];
const DECODE_LATER = ["tiff", "tif", "tga", "dds", "qoi", "hdr", "exr", "heic", "heif", "psd", "psb", "cr2", "cr3", "nef", "arw", "orf", "rw2", "dng", "raf"];

export const imageHandler: FormatHandler = {
  name: "image",
  exts: [...NATIVE, ...DECODE_LATER],
  canHandle: (f) => f.kind === "image",
  resolve: (f) =>
    NATIVE.includes(f.ext)
      ? { kind: "image", strategy: "native", component: ImageView }
      : {
          kind: "image",
          strategy: "decode-rust",
          component: PlaceholderView,
          reason: "该图片格式需 Rust 解码库(RAW/HEIC/PSD/TIFF 等,后续里程碑 M2)",
        },
};
