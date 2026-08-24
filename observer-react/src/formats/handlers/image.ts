import type { FormatHandler } from "../types";
import { ImageView } from "../../components/preview/ImageView";
import { GifView } from "../../components/preview/GifView";
import { IcoView } from "../../components/preview/IcoView";
import { DecodedImageView } from "../../components/preview/DecodedImageView";
import { PlaceholderView } from "../../components/preview/PlaceholderView";

// WebView 原生可显示的图片。gif / ico 分流到专用组件(gif 逐帧、ico 多尺寸,§第二批)。
const NATIVE = ["png", "jpg", "jpeg", "webp", "svg", "bmp", "avif"];
// M2 Rust 解码(image/psd crate → PNG):tiff/tga/exr/dds/qoi/hdr/psd/psb → DecodedImageView。
const DECODE_RUST = ["tiff", "tif", "tga", "dds", "qoi", "hdr", "exr", "psd", "psb"];
// 仍占位(后续里程碑):HEIC/RAW 依赖最重,本轮不做。
const DECODE_LATER = ["heic", "heif", "cr2", "cr3", "nef", "arw", "orf", "rw2", "dng", "raf"];

export const imageHandler: FormatHandler = {
  name: "image",
  exts: [...NATIVE, "gif", "ico", ...DECODE_RUST, ...DECODE_LATER],
  canHandle: (f) => f.kind === "image",
  resolve: (f) => {
    if (f.ext === "gif") return { kind: "image", strategy: "native", component: GifView };
    if (f.ext === "ico") return { kind: "image", strategy: "native", component: IcoView };
    if (NATIVE.includes(f.ext)) return { kind: "image", strategy: "native", component: ImageView };
    if (DECODE_RUST.includes(f.ext))
      return { kind: "image", strategy: "decode-rust", component: DecodedImageView };
    return {
      kind: "image",
      strategy: "decode-rust",
      component: PlaceholderView,
      reason: "该图片格式需更重的解码依赖(RAW/HEIC,后续里程碑)",
    };
  },
};
