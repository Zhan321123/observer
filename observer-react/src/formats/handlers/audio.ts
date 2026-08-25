import type { FormatHandler } from "../types";
import { AudioView } from "../../components/preview/AudioView";
import { StreamAudioView } from "../../components/preview/StreamAudioView";
import { MidiView } from "../../components/preview/MidiView";
import { PlaceholderView } from "../../components/preview/PlaceholderView";

// WebView2 原生可播音频。
// 注:m4s 在此仅承接"纯音频 m4s"(B站 audio.m4s = AAC-in-MP4,原生可直放);
// 含视频流的 m4s 由 detect_format 判为 video,仍走视频 handler,不会到这里。
const NATIVE = ["mp3", "wav", "ogg", "oga", "m4a", "aac", "flac", "opus", "weba", "m4s"];
// M3 非常规音频:FFmpeg 可 demux/decode → 复用 loopback 流式(seek=改 t 重启)→ StreamAudioView。
const STREAM = ["ape", "wv", "tta", "wma", "aiff", "aif", "dsf", "dff"];
// M3 MIDI:rustysynth SoundFont 合成 → WAV → 原生播放(需用户提供 .sf2,见 MidiView)。
const MIDI = ["mid", "midi"];
// Tracker/chiptune:libopenmpt 为 C 库、随包编译风险高,本轮保持优雅占位(不破坏构建)。
const TRACKER = ["mod", "xm", "s3m", "it"];

export const audioHandler: FormatHandler = {
  name: "audio",
  exts: [...NATIVE, ...STREAM, ...MIDI, ...TRACKER],
  canHandle: (f) => f.kind === "audio",
  resolve: (f) => {
    if (NATIVE.includes(f.ext)) return { kind: "audio", strategy: "native", component: AudioView };
    if (STREAM.includes(f.ext))
      return { kind: "audio", strategy: "ffmpeg-stream", component: StreamAudioView };
    if (MIDI.includes(f.ext)) return { kind: "audio", strategy: "native", component: MidiView };
    return {
      kind: "audio",
      strategy: "ffmpeg-stream",
      component: PlaceholderView,
      reason: "Tracker 模块音乐(mod/xm/s3m/it)需 libopenmpt(C 库),为保构建稳定本轮保持占位",
    };
  },
};
