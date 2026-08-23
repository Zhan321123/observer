import { useEffect, useRef, useState } from "react";
import { Play, Pause, Volume2, VolumeX } from "lucide-react";
import { assetUrl } from "../../lib/tauri";
import { clamp, formatTime } from "../../lib/format";
import { useCellViewStore, type FitMode } from "../../stores/cellViewStore";
import { registerControl } from "../../stores/cellControls";
import type { PreviewProps } from "../../formats/types";

const RATES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2];

/**
 * 视频/音频共用的预览核心:媒体元素 + 格内自制控制条。
 * 交互(§4.5):已选中时点击画面=播放/暂停,滚轮=调音量。
 * 数据态同步到 cellViewStore,动作注册到 cellControls(供功能条驱动)。
 */
export function MediaCore({ file, cellId, active, isVideo }: PreviewProps & { isVideo: boolean }) {
  const mediaRef = useRef<HTMLVideoElement | HTMLAudioElement | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [fitMode, setFitModeLocal] = useState<FitMode>("best-fit");
  const [zoom, setZoom] = useState(1);

  const setView = useCellViewStore((s) => s.setView);
  const view = useCellViewStore((s) => s.views[cellId]);
  const setFullView = useCellViewStore((s) => s.setFullView);
  const setFullScreen = useCellViewStore((s) => s.setFullScreen);

  const playing = view?.playing ?? false;
  const currentTime = view?.currentTime ?? 0;
  const duration = view?.duration ?? 0;
  const volume = view?.volume ?? 1;
  const rate = view?.rate ?? 1;
  const muted = (view?.volume ?? 1) === 0;

  // 事件订阅:把媒体元素状态同步进 store;loadedmetadata 时恢复保存的播放位置(全界面切换/未来续播)
  useEffect(() => {
    const m = mediaRef.current;
    if (!m) return;
    const sync = () =>
      setView(cellId, {
        currentTime: m.currentTime,
        duration: Number.isFinite(m.duration) ? m.duration : 0,
        volume: m.volume,
        rate: m.playbackRate,
        playing: !m.paused,
      });
    const onLoaded = () => {
      const saved = useCellViewStore.getState().views[cellId];
      if (
        saved?.currentTime &&
        saved.currentTime > 0 &&
        Number.isFinite(m.duration) &&
        saved.currentTime < m.duration
      ) {
        m.currentTime = saved.currentTime;
        if (saved.playing) void m.play();
      }
      sync();
    };
    const onErr = () => setView(cellId, { error: "无法解码/格式不受支持(WebView2 原生)" });
    m.addEventListener("timeupdate", sync);
    m.addEventListener("play", sync);
    m.addEventListener("pause", sync);
    m.addEventListener("volumechange", sync);
    m.addEventListener("ratechange", sync);
    m.addEventListener("loadedmetadata", onLoaded);
    m.addEventListener("durationchange", sync);
    m.addEventListener("error", onErr);
    return () => {
      m.removeEventListener("timeupdate", sync);
      m.removeEventListener("play", sync);
      m.removeEventListener("pause", sync);
      m.removeEventListener("volumechange", sync);
      m.removeEventListener("ratechange", sync);
      m.removeEventListener("loadedmetadata", onLoaded);
      m.removeEventListener("durationchange", sync);
      m.removeEventListener("error", onErr);
    };
  }, [cellId, setView]);

  // 滚轮调音量(仅选中格)
  useEffect(() => {
    const c = containerRef.current;
    if (!c) return;
    const onWheel = (e: WheelEvent) => {
      if (!active) return;
      e.preventDefault();
      const m = mediaRef.current;
      if (!m) return;
      m.volume = clamp(m.volume + (e.deltaY < 0 ? 0.05 : -0.05), 0, 1);
    };
    c.addEventListener("wheel", onWheel, { passive: false });
    return () => c.removeEventListener("wheel", onWheel);
  }, [active]);

  // 命令式控制(功能条驱动)
  useEffect(
    () =>
      registerControl(cellId, {
        kind: isVideo ? "video" : "audio",
        play: () => void mediaRef.current?.play(),
        pause: () => mediaRef.current?.pause(),
        toggle: () => {
          const m = mediaRef.current;
          if (m) (m.paused ? void m.play() : m.pause());
        },
        seek: (t) => {
          const m = mediaRef.current;
          if (m) m.currentTime = clamp(t, 0, m.duration || t);
        },
        stepFrame: (dir) => {
          const m = mediaRef.current;
          if (m) {
            m.pause();
            m.currentTime = clamp(m.currentTime + dir / 30, 0, m.duration || 0);
          }
        },
        setVolume: (v) => {
          const m = mediaRef.current;
          if (m) m.volume = clamp(v, 0, 1);
        },
        setRate: (r) => {
          const m = mediaRef.current;
          if (m) m.playbackRate = r;
        },
        setFitMode: (m2) => {
          setFitModeLocal(m2);
          setZoom(1);
          setView(cellId, { fitMode: m2, scale: 1 });
        },
        setZoom: (s) => {
          setZoom(clamp(s, 0.1, 8));
          setFitModeLocal("free");
          setView(cellId, { fitMode: "free", scale: s });
        },
        enterFullView: () => setFullView(cellId),
        enterFullScreen: () => {
          setFullView(cellId);
          setFullScreen(true);
        },
      }),
    [cellId, isVideo, setView, setFullView, setFullScreen]
  );

  const onToggleClick = () => {
    if (!active) return; // 未选中时点击只改选中态(GridCell 已处理)
    const m = mediaRef.current;
    if (m) (m.paused ? void m.play() : m.pause());
  };

  const mediaStyle: React.CSSProperties = isVideo
    ? {
        width: "100%",
        height: "100%",
        objectFit: fitMode === "actual" ? "none" : "contain",
        transform: `scale(${zoom})`,
        transformOrigin: "center center",
      }
    : { display: "none" };

  return (
    <div ref={containerRef} className="flex h-full w-full flex-col bg-black/20">
      {/* 可视区 */}
      <div
        className="relative min-h-0 flex-1 overflow-hidden"
        onClick={onToggleClick}
        style={{ cursor: active ? "pointer" : "default" }}
      >
        {isVideo ? (
          <video ref={mediaRef as React.RefObject<HTMLVideoElement>} src={assetUrl(file.path)} style={mediaStyle} playsInline />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-3">
            <audio ref={mediaRef as React.RefObject<HTMLAudioElement>} src={assetUrl(file.path)} />
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-brand/20">
              {playing ? <Pause size={28} className="text-brand-bright" /> : <Play size={28} className="text-brand-bright" />}
            </div>
            <div className="max-w-full truncate px-4 text-xs text-text-dim">{file.name}</div>
          </div>
        )}
      </div>

      {/* 格内控制条 */}
      <div className="flex items-center gap-2 border-t border-line bg-panel px-2 py-1">
        <button
          className="text-text hover:text-brand-bright"
          onClick={() => {
            const m = mediaRef.current;
            if (m) (m.paused ? void m.play() : m.pause());
          }}
          title={playing ? "暂停" : "播放"}
        >
          {playing ? <Pause size={15} /> : <Play size={15} />}
        </button>
        <span className="shrink-0 text-[11px] tabular-nums text-text-dim">
          {formatTime(currentTime)} / {formatTime(duration)}
        </span>
        <input
          type="range"
          className="h-1 min-w-0 flex-1 accent-brand-bright"
          min={0}
          max={duration || 0}
          step={0.01}
          value={currentTime}
          onChange={(e) => {
            const m = mediaRef.current;
            if (m) m.currentTime = Number(e.target.value);
          }}
        />
        <button
          className="text-text hover:text-brand-bright"
          onClick={() => {
            const m = mediaRef.current;
            if (m) m.volume = muted ? 1 : 0;
          }}
          title={muted ? "取消静音" : "静音"}
        >
          {muted ? <VolumeX size={15} /> : <Volume2 size={15} />}
        </button>
        <input
          type="range"
          className="h-1 w-14 accent-brand-bright"
          min={0}
          max={1}
          step={0.01}
          value={volume}
          onChange={(e) => {
            const m = mediaRef.current;
            if (m) m.volume = Number(e.target.value);
          }}
          title="音量"
        />
        <select
          className="rounded bg-panel-2 px-1 text-[11px] text-text outline-none"
          value={rate}
          onChange={(e) => {
            const m = mediaRef.current;
            if (m) m.playbackRate = Number(e.target.value);
          }}
          title="播放速度"
        >
          {RATES.map((r) => (
            <option key={r} value={r}>
              {r}×
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
