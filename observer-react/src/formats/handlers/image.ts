import type { FormatHandler } from "../types";
import { ImageView } from "../../components/preview/ImageView";
import { GifView } from "../../components/preview/GifView";
import { IcoView } from "../../components/preview/IcoView";
import { DecodedImageView } from "../../components/preview/DecodedImageView";

// WebView 原生可显示的图片。gif / ico 分流到专用组件(gif 逐帧、ico 多尺寸,§第二批)。
const NATIVE = ["png", "jpg", "jpeg", "webp", "svg", "bmp", "avif"];
// M2 Rust 解码(image/psd crate → PNG;RAW 走 rawler、HEIC 走 heic crate)→ DecodedImageView。
const DECODE_RUST = [
  "tiff", "tif", "tga", "dds", "qoi", "hdr", "exr", "psd", "psb",
  // HEIC/HEIF(heic crate,纯 Rust HEVC)
  "heic", "heif",
  // RAW(rrawler,纯 Rust demosaic+显影)
  "cr2", "cr3", "nef", "arw", "orf", "rw2", "dng", "raf",
];

export const imageHandler: FormatHandler = {
  name: "image",
  exts: [...NATIVE, "gif", "ico", ...DECODE_RUST],
  canHandle: (f) => f.kind === "image",
  resolve: (f) => {
    if (f.ext === "gif") return { kind: "image", strategy: "native", component: GifView };
    if (f.ext === "ico") return { kind: "image", strategy: "native", component: IcoView };
    if (NATIVE.includes(f.ext)) return { kind: "image", strategy: "native", component: ImageView };
    return { kind: "image", strategy: "decode-rust", component: DecodedImageView };
  },
};
