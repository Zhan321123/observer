import type { FormatHandler } from "../types";
import { VideoView } from "../../components/preview/VideoView";
import { PlaceholderView } from "../../components/preview/PlaceholderView";

// WebView2 原生可播:H.264/AAC 的 mp4、vp8/9 的 webm。HEVC 需付费商店扩展,故 mkv/hevc 等一律走 ffmpeg 占位(M1)。
const NATIVE = ["mp4", "webm", "m4v", "ogv"];

export const videoHandler: FormatHandler = {
  name: "video",
  exts: [
    ...NATIVE,
    "mkv", "ts", "m2ts", "mts", "m4s", "mov", "wmv", "asf", "flv", "vob",
    "rm", "rmvb", "3gp", "y4m", "avi", "mpg", "mpeg", "hevc",
  ],
  canHandle: (f) => f.kind === "video",
  resolve: (f) =>
    NATIVE.includes(f.ext)
      ? { kind: "video", strategy: "native", component: VideoView }
      : {
          kind: "video",
          strategy: "ffmpeg-stream",
          component: PlaceholderView,
          reason: "该容器/编码需 FFmpeg remux 或转码(后续里程碑 M1)",
        },
};
