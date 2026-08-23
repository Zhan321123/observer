import type { FormatHandler } from "../types";
import { AudioView } from "../../components/preview/AudioView";
import { PlaceholderView } from "../../components/preview/PlaceholderView";

// WebView2 原生可播音频。ape/wv/tta/dsf/midi/tracker 等走 ffmpeg/合成占位(M1/M3)。
const NATIVE = ["mp3", "wav", "ogg", "oga", "m4a", "aac", "flac", "opus", "weba"];

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
