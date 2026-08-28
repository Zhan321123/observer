import type { FormatHandler } from "../types";
import { ImageView } from "../../components/preview/ImageView";
import { GifView } from "../../components/preview/GifView";
import { IcoView } from "../../components/preview/IcoView";
import { DecodedImageView } from "../../components/preview/DecodedImageView";

// WebView 原生可显示的图片。gif / ico 分流到专用组件(gif 逐帧、ico 多尺寸,§第二批)。
// svgz(gzip 压缩的 SVG)Chromium 不能直读,由 ImageView 先 fetch+gunzip 再喂 blob(task2 一)。
const NATIVE = ["png", "jpg", "jpeg", "webp", "svg", "bmp", "avif", "apng"];
// M2 Rust 解码(image/psd crate → PNG;RAW 走 rawler、HEIC 走 heic crate)→ DecodedImageView。
const DECODE_RUST = [
  "tiff", "tif", "tga", "dds", "qoi", "hdr", "exr", "psd", "psb",
  // HEIC/HEIF(heic crate,纯 Rust HEVC)
  "heic", "heif",
  // RAW(rrawler,纯 Rust demosaic+显影;task2 一补登记 pef/srw/x3f/iiq,rawler 已支持)
  "cr2", "cr3", "nef", "arw", "orf", "rw2", "dng", "raf", "pef", "srw", "x3f", "iiq",
];

export const imageHandler: FormatHandler = {
  name: "image",
  exts: [...NATIVE, "svgz", "gif", "ico", ...DECODE_RUST],
  canHandle: (f) => f.kind === "image",
  resolve: (f) => {
    if (f.ext === "gif") return { kind: "image", strategy: "native", component: GifView };
    if (f.ext === "ico") return { kind: "image", strategy: "native", component: IcoView };
    if (NATIVE.includes(f.ext) || f.ext === "svgz")
      return { kind: "image", strategy: "native", component: ImageView };
    return { kind: "image", strategy: "decode-rust", component: DecodedImageView };
  },
};
