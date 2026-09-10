import { Pause, Play, PictureInPicture2, SkipBack, SkipForward, Volume2, VolumeX } from "lucide-react";
import { BarButton, Sep } from "../FunctionBar";
import { WaveformSeekBar } from "../preview/WaveformSeekBar";
import { formatTime } from "../../lib/format";
import { useUiStore } from "../../stores/uiStore";
import { usePlayerStore, type AudioDisplay, type PlayOrder } from "../../stores/playerStore";

const RATES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2];

/**
 * 播放器页底部工具栏(§播放器):上/播/下一首 + 波形进度条 + 播放顺序(顺序/逆序/随机/
 * 单曲循环,默认顺序)+ 显示模式(频谱图/滚动波形/无)+ 音量/倍速。空队列全禁用。
 * 波形 seek:原生/合成拖动即跳(live),流式松手才跳(改 t 重启 ffmpeg,防逐像素重启)。
 */
export function PlayerToolbar() {
  const playing = usePlayerStore((s) => s.playing);
  const currentTime = usePlayerStore((s) => s.currentTime);
  const duration = usePlayerStore((s) => s.duration);
  const volume = usePlayerStore((s) => s.volume);
  const rate = usePlayerStore((s) => s.rate);
  const order = usePlayerStore((s) => s.order);
  const display = usePlayerStore((s) => s.display);
  const srcKind = usePlayerStore((s) => s.srcKind);
  const waveformPath = usePlayerStore((s) => s.waveformPath);
  const hasTrack = usePlayerStore((s) => s.index >= 0);

  const toggle = usePlayerStore((s) => s.toggle);
  const next = usePlayerStore((s) => s.next);
  const prev = usePlayerStore((s) => s.prev);
  const seek = usePlayerStore((s) => s.seek);
  const setVolume = usePlayerStore((s) => s.setVolume);
  const setRate = usePlayerStore((s) => s.setRate);
  const setOrder = usePlayerStore((s) => s.setOrder);
  const setDisplay = usePlayerStore((s) => s.setDisplay);
  const setMini = useUiStore((s) => s.setMini);

  const muted = volume === 0;
  const selectCls = "rounded bg-panel-2 px-1 text-[11px] text-text outline-none";

  return (
    <div className="flex h-11 shrink-0 items-center gap-1 overflow-x-auto border-t border-line bg-panel px-2">
      <BarButton title="上一首" disabled={!hasTrack} onClick={() => prev()}>
        <SkipBack size={16} />
      </BarButton>
      <BarButton title={playing ? "暂停" : "播放"} disabled={!hasTrack} onClick={() => toggle()}>
        {playing ? <Pause size={16} /> : <Play size={16} />}
      </BarButton>
      <BarButton title="下一首" disabled={!hasTrack} onClick={() => next()}>
        <SkipForward size={16} />
      </BarButton>

      <span className="shrink-0 px-1 text-[11px] tabular-nums text-text-dim">
        {formatTime(currentTime)} / {formatTime(duration)}
      </span>

      {waveformPath ? (
        <WaveformSeekBar
          path={waveformPath}
          duration={duration}
          value={currentTime}
          live={srcKind !== "stream"}
          onSeek={(t) => seek(t)}
        />
      ) : (
        <div className="h-7 min-w-0 flex-1" />
      )}

      <select
        className={selectCls}
        value={order}
        onChange={(e) => setOrder(e.target.value as PlayOrder)}
        title="播放顺序(顺序/逆序播完回绕;随机整轮不重复;单曲循环仅自然播完)"
      >
        <option value="seq">顺序</option>
        <option value="reverse">逆序</option>
        <option value="shuffle">随机</option>
        <option value="repeat-one">单曲循环</option>
      </select>

      <select
        className={selectCls}
        value={display}
        onChange={(e) => setDisplay(e.target.value as AudioDisplay)}
        title="主区显示模式"
      >
        <option value="bars">频谱图</option>
        <option value="wave">滚动波形</option>
        <option value="none">无</option>
      </select>

      <BarButton
        title="小窗模式(迷你播放器,默认置顶;Esc 退出)"
        onClick={() => setMini(true)}
      >
        <PictureInPicture2 size={16} />
      </BarButton>

      <Sep />

      <BarButton
        title={muted ? "取消静音" : "静音"}
        disabled={!hasTrack}
        onClick={() => setVolume(muted ? 1 : 0)}
      >
        {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
      </BarButton>
      <input
        type="range"
        className="h-1 w-16 accent-brand-bright"
        min={0}
        max={1}
        step={0.01}
        value={volume}
        onChange={(e) => setVolume(Number(e.target.value))}
        title="音量(按歌曲记忆)"
      />
      <select
        className={selectCls}
        value={rate}
        onChange={(e) => setRate(Number(e.target.value))}
        title="播放速度"
      >
        {RATES.map((r) => (
          <option key={r} value={r}>
            {r}×
          </option>
        ))}
      </select>
    </div>
  );
}
