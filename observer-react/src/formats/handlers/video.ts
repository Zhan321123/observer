import type { FormatHandler } from "../types";
import { VideoView } from "../../components/preview/VideoView";
import { StreamVideoView } from "../../components/preview/StreamVideoView";

// WebView2 原生可播:H.264/AAC 的 mp4、vp8/9 的 webm → asset:// 直放(M0)。
// 其余容器/编码(mkv/ts/mov/wmv/flv/avi/hevc/m4s…)→ M1 FFmpeg 流(remux 优先,否则转码)。
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
          component: StreamVideoView,
          reason: "FFmpeg 流式预览(remux/转码)",
        },
};
