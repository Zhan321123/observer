import type { FormatHandler } from "../types";
import { AudioView } from "../../components/preview/AudioView";
import { PlaceholderView } from "../../components/preview/PlaceholderView";

// WebView2 原生可播音频。ape/wv/tta/dsf/midi/tracker 等走 ffmpeg/合成占位(M1/M3)。
// 注:m4s 在此仅承接"纯音频 m4s"(B站 audio.m4s = AAC-in-MP4,原生可直放);
// 含视频流的 m4s 由 detect_format 判为 video,仍走视频 handler,不会到这里。
const NATIVE = ["mp3", "wav", "ogg", "oga", "m4a", "aac", "flac", "opus", "weba", "m4s"];

export const audioHandler: FormatHandler = {
  name: "audio",
  exts: [
    ...NATIVE,
    "ape", "wv", "tta", "wma", "aiff", "aif", "dsf", "dff", "mid", "midi",
    "mod", "xm", "s3m", "it",
  ],
  canHandle: (f) => f.kind === "audio",
  resolve: (f) =>
    NATIVE.includes(f.ext)
      ? { kind: "audio", strategy: "native", component: AudioView }
      : {
          kind: "audio",
          strategy: "ffmpeg-stream",
          component: PlaceholderView,
          reason: "该音频格式需 FFmpeg 解码或合成(rustysynth/libopenmpt,后续里程碑 M1/M3)",
        },
};
