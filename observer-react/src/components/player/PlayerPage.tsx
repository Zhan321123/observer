import { useState } from "react";
import { ChevronDown, ChevronRight, Loader2, Music4 } from "lucide-react";
import { usePlayerStore } from "../../stores/playerStore";
import { SpectrumBars } from "../preview/SpectrumBars";
import { ScrollWaveform } from "../preview/ScrollWaveform";

/**
 * 播放器页主区(§播放器):曲名 + 实时频谱/滚动波形/无(display 三态,同宫格音频预览,
 * 底部工具栏切换)+ 歌词预留折叠区。曲目的选择/跳播由左侧文件 frame 承担
 * (播放器页文件树仅显示音频文件,点击即跳播,迭代二)。
 * 播放引擎在页面外常驻(PlayerEngine),此处纯展示;点击主体 = 播放/暂停。
 */
export function PlayerPage() {
  const display = usePlayerStore((s) => s.display);
  const analyser = usePlayerStore((s) => s.analyser);
  const waveformPath = usePlayerStore((s) => s.waveformPath);
  const duration = usePlayerStore((s) => s.duration);
  const currentTime = usePlayerStore((s) => s.currentTime);
  const name = usePlayerStore((s) => s.queue[s.index]?.name ?? null);
  const queueLoading = usePlayerStore((s) => s.queueLoading);
  const queueEmpty = usePlayerStore((s) => s.queue.length === 0);
  const loading = usePlayerStore((s) => s.loading);
  const error = usePlayerStore((s) => s.error);
  const toggle = usePlayerStore((s) => s.toggle);
  const seek = usePlayerStore((s) => s.seek);
  const [lyricsOpen, setLyricsOpen] = useState(false);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* 主体:可视化 + 曲名;点击 = 播放/暂停 */}
      <div
        className="flex min-h-0 flex-1 cursor-pointer select-none flex-col items-center justify-center gap-4 bg-black/20 px-6 py-4"
        onClick={() => toggle()}
      >
        {queueLoading ? (
          <div className="flex flex-col items-center gap-2 text-text-dim">
            <Loader2 size={28} className="animate-spin" />
            <div className="text-xs">正在扫描文件夹(含子文件夹)中的音频…</div>
          </div>
        ) : queueEmpty ? (
          <div className="flex flex-col items-center gap-2 text-text-dim">
            <Music4 size={30} className="text-text-dim/50" />
            <div className="text-xs">当前文件夹(含子文件夹)没有可播放的音频</div>
            <div className="text-[11px] text-text-dim/60">左侧文件列表仅显示音频文件,点击即可播放</div>
          </div>
        ) : (
          <>
            {loading && <Loader2 size={20} className="shrink-0 animate-spin text-text-dim" />}
            <div className="max-w-full shrink-0 truncate text-sm text-text" title={name ?? undefined}>
              {name}
            </div>
            {error && (
              <div className="max-w-md shrink-0 text-center text-xs leading-relaxed text-danger">
                {error}
              </div>
            )}
            {display === "bars" && (
              // flex + 定高 + shrink-0:SpectrumBars 根靠 flex-1 取高度,block 容器高度链断裂
              <div className="flex h-56 w-full max-w-4xl shrink-0">
                <SpectrumBars analyser={analyser} />
              </div>
            )}
            {display === "wave" && (
              // 波形点击 = seek,不冒泡(否则同时触发主体的播放/暂停切换)
              <div
                className="flex h-48 w-full max-w-3xl shrink-0"
                onClick={(e) => e.stopPropagation()}
              >
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
            {/* 歌词预留(本轮不实现解析,只留布局位与数据模型 playerStore.lyrics) */}
            <div className="w-full max-w-3xl rounded-md border border-line bg-panel/60">
              <button
                className="flex w-full items-center gap-1 px-2 py-1 text-[11px] text-text-dim hover:text-text"
                onClick={(e) => {
                  e.stopPropagation();
                  setLyricsOpen((o) => !o);
                }}
              >
                {lyricsOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                歌词(预留)
              </button>
              {lyricsOpen && (
                <div className="px-3 pb-2 text-xs leading-relaxed text-text-dim/60">
                  歌词功能预留:后续支持 .lrc/.srt 等加载与逐行同步滚动
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
