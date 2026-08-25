import { useEffect, useState } from "react";
import { Music4, Loader2 } from "lucide-react";
import { midiRender, assetUrl, allowAssetPath } from "../../lib/tauri";
import { MediaCore } from "./MediaCore";
import type { PreviewProps } from "../../formats/types";

/**
 * MIDI 预览(M3):rustysynth SoundFont 合成 → WAV 磁盘缓存,经原生 <audio> 播放(天然可 seek)。
 * 播放/进度/音量持久化仍按原 .mid 路径;波形取合成出的 WAV(ffmpeg 可解,mid 不可)。
 * 无 SoundFont(.sf2)→ 明确占位:提示配置 OBSERVER_SOUNDFONT 或放置 soundfont.sf2。
 */
export function MidiView(props: PreviewProps) {
  const { file } = props;
  const [wav, setWav] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setWav(null);
    setErr(null);
    void (async () => {
      try {
        const wavPath = await midiRender(file.path);
        await allowAssetPath(wavPath).catch(() => {});
        if (!cancelled) setWav(wavPath);
      } catch (e) {
        if (!cancelled) setErr(String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [file.path]);

  if (err) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-2 p-4 text-center">
        <Music4 size={34} className="text-text-dim" />
        <div className="max-w-full truncate text-sm text-text">{file.name}</div>
        <div className="text-xs text-text-dim">MIDI 需要 SoundFont(.sf2)才能合成发声</div>
        <div className="max-w-md text-xs leading-relaxed text-text-dim/70">{err}</div>
      </div>
    );
  }
  if (!wav) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-2 p-4 text-center">
        <Loader2 size={30} className="animate-spin text-text-dim" />
        <div className="max-w-full truncate text-sm text-text">{file.name}</div>
        <div className="text-xs text-text-dim">MIDI 合成中…</div>
      </div>
    );
  }
  // 播放合成出的 WAV;进度/音量/波形都基于 WAV,持久化按原 mid 路径
  return (
    <MediaCore {...props} isVideo={false} srcOverride={assetUrl(wav)} waveformPath={wav} />
  );
}
