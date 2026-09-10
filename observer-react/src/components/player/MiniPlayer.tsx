import { useEffect } from "react";
import { Loader2, Maximize2, Music4, Pause, Pin, PinOff, Play, SkipForward } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useUiStore } from "../../stores/uiStore";
import { usePlayerStore } from "../../stores/playerStore";
import { SpectrumBars } from "../preview/SpectrumBars";
import { ScrollWaveform } from "../preview/ScrollWaveform";
import { SeekBar } from "../preview/SeekBar";

/**
 * 小窗模式(§播放器迭代二):主窗口缩小后的整窗迷你播放器。
 * 中央 = 曲名 + 用户选中的可视化(频谱/波形/无,display 与完整播放器页共享);
 * 鼠标悬浮浮现控件:右上角 置顶开关/退出小窗,底部 播放暂停/下一首/进度条。
 * 主体点击 = 播放/暂停;Esc 退出小窗。播放引擎常驻在页面结构之外,切小窗不断播。
 */
export function MiniPlayer() {
  const display = usePlayerStore((s) => s.display);
  const analyser = usePlayerStore((s) => s.analyser);
  const waveformPath = usePlayerStore((s) => s.waveformPath);
  const duration = usePlayerStore((s) => s.duration);
  const currentTime = usePlayerStore((s) => s.currentTime);
  const srcKind = usePlayerStore((s) => s.srcKind);
  const name = usePlayerStore((s) => (s.index >= 0 ? s.queue[s.index]?.name ?? null : null));
  const playing = usePlayerStore((s) => s.playing);
  const loading = usePlayerStore((s) => s.loading);
  const error = usePlayerStore((s) => s.error);
  const hasTrack = usePlayerStore((s) => s.index >= 0);

  const toggle = usePlayerStore((s) => s.toggle);
  const next = usePlayerStore((s) => s.next);
  const seek = usePlayerStore((s) => s.seek);

  const miniTop = useUiStore((s) => s.miniTop);
  const setMini = useUiStore((s) => s.setMini);
  const setMiniTop = useUiStore((s) => s.setMiniTop);

  // Esc 退出小窗(仿 FullViewOverlay:capture 阶段)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setMini(false);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [setMini]);

  const toggleTop = () => {
    const top = !miniTop;
    setMiniTop(top);
    void getCurrentWindow().setAlwaysOnTop(top).catch(() => {});
  };

  const ctrlBtn =
    "flex h-8 w-8 items-center justify-center rounded-full bg-black/50 text-white/90 backdrop-blur hover:bg-black/70 disabled:opacity-30";

  return (
    <div
      className="group relative flex h-full w-full select-none flex-col items-center justify-center gap-3 bg-panel-2 px-4 pb-10 pt-6"
      onClick={() => toggle()}
    >
      {/* 中央:曲名 + 可视化(display 与完整播放器页共享)。
          可视化容器必须是 flex + 定高 + shrink-0:SpectrumBars/ScrollWaveform 根元素靠
          flex-1 取高度,普通 block 容器下高度链断裂(画布尺寸异常);shrink-0 防 flex 列挤压 */}
      {name ? (
        <>
          <div className="max-w-full shrink-0 truncate text-center text-sm text-text" title={name}>
            {name}
          </div>
          {loading && <Loader2 size={16} className="shrink-0 animate-spin text-text-dim" />}
          {error && (
            <div className="max-w-full shrink-0 text-center text-[11px] leading-relaxed text-danger">
              {error}
            </div>
          )}
          {display === "bars" && (
            <div className="flex h-24 w-full shrink-0">
              <SpectrumBars analyser={analyser} />
            </div>
          )}
          {display === "wave" && (
            // 波形点击 = seek,不冒泡(否则同时触发主体的播放/暂停切换)
            <div className="flex h-20 w-full shrink-0" onClick={(e) => e.stopPropagation()}>
              {waveformPath && (
                <ScrollWaveform
                  path={waveformPath}
                  duration={duration}
                  value={currentTime}
                  onSeek={(t) => seek(t)}
                />
              )}
            </div>
          )}
        </>
      ) : (
        <div className="flex flex-col items-center gap-2 text-text-dim">
          {loading ? (
            <Loader2 size={22} className="animate-spin" />
          ) : (
            <Music4 size={24} className="text-text-dim/50" />
          )}
          <div className="text-[11px]">当前文件夹没有可播放的音频</div>
        </div>
      )}

      {/* 悬浮控件:右上角 置顶/退出小窗 */}
      <div
        className="absolute right-2 top-2 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          className={`${ctrlBtn} ${miniTop ? "text-brand-bright" : ""}`}
          onClick={toggleTop}
          title={miniTop ? "取消置顶" : "置顶"}
        >
          {miniTop ? <Pin size={14} /> : <PinOff size={14} />}
        </button>
        <button className={ctrlBtn} onClick={() => setMini(false)} title="退出小窗(Esc)">
          <Maximize2 size={14} />
        </button>
      </div>

      {/* 悬浮控件:底部 播放/暂停、下一首、进度条 */}
      <div
        className="absolute inset-x-2 bottom-2 flex items-center gap-2 rounded-lg bg-black/50 px-2 py-1.5 opacity-0 backdrop-blur transition-opacity group-hover:opacity-100"
        onClick={(e) => e.stopPropagation()}
      >
        <button className="text-white/90 hover:text-brand-bright disabled:opacity-30" onClick={() => toggle()} disabled={!hasTrack} title={playing ? "暂停" : "播放"}>
          {playing ? <Pause size={16} /> : <Play size={16} />}
        </button>
        <button className="text-white/90 hover:text-brand-bright disabled:opacity-30" onClick={() => next()} disabled={!hasTrack} title="下一首">
          <SkipForward size={15} />
        </button>
        <SeekBar
          duration={duration}
          value={currentTime}
          onSeek={(t) => seek(t)}
          live={srcKind !== "stream"}
          className="h-1 min-w-0 flex-1 accent-brand-bright"
        />
      </div>
    </div>
  );
}
