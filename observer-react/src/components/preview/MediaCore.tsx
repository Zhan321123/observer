import { useEffect, useRef, useState } from "react";
import { Play, Pause, Volume2, VolumeX } from "lucide-react";
import { assetUrl, ffprobeMeta } from "../../lib/tauri";
import { mediaPosGet, mediaPosSet } from "../../lib/persist";
import { clamp, formatTime } from "../../lib/format";
import { useCellViewStore, type FitMode } from "../../stores/cellViewStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { registerControl } from "../../stores/cellControls";
import { VideoSeekBar } from "./VideoSeekBar";
import { Waveform } from "./Waveform";
import { SeekBar } from "./SeekBar";
import type { PreviewProps } from "../../formats/types";

const RATES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2];

/**
 * 视频/音频共用的预览核心:媒体元素 + 格内自制控制条。
 * 交互(§4.5):已选中时点击画面=播放/暂停,滚轮=调音量。
 * 数据态同步到 cellViewStore,动作注册到 cellControls(供功能条驱动)。
 * srcOverride:播放字节来源覆盖(MIDI 等:播放合成出的 WAV,但进度/音量持久化仍按原 file.path)。
 * waveformPath:波形取峰值的路径(默认同 file.path;MIDI 传合成出的 WAV,ffmpeg 可解)。
 */
export function MediaCore({
  file,
  cellId,
  active,
  isVideo,
  srcOverride,
  waveformPath,
}: PreviewProps & { isVideo: boolean; srcOverride?: string; waveformPath?: string }) {
  const mediaRef = useRef<HTMLVideoElement | HTMLAudioElement | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  // 播放位置 + 音量/倍速持久化:posRef 记最新 {path,t,d,v,r} 供卸载/节流保存;lastSaveRef 控制 ~5s 节流
  const posRef = useRef<{ path: string; t: number; d: number; v: number; r: number } | null>(null);
  const lastSaveRef = useRef(0);
  const frameRateRef = useRef(0); // ffprobe 帧率(逐帧步长用;0=未知→回退 1/30)
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

  // 事件订阅:把媒体元素状态同步进 store;loadedmetadata 时恢复播放位置
  // (优先 cellViewStore 瞬态——全界面切换保留;否则 media_position 持久化——重启/重开续播)。
  useEffect(() => {
    const m = mediaRef.current;
    if (!m) return;
    const path = file.path;
    const dur = () => (Number.isFinite(m.duration) ? m.duration : 0);
    const savePos = () => {
      if (dur() > 0)
        void mediaPosSet(path, m.currentTime, m.duration, m.volume, m.playbackRate).catch(() => {});
    };
    const sync = () => {
      posRef.current = { path, t: m.currentTime, d: m.duration, v: m.volume, r: m.playbackRate };
      setView(cellId, {
        currentTime: m.currentTime,
        duration: dur(),
        volume: m.volume,
        rate: m.playbackRate,
        playing: !m.paused,
      });
      // 播放中每 ~5s 落盘一次(暂停/关闭/退出另有精确保存)
      const nowT = Date.now();
      if (!m.paused && nowT - lastSaveRef.current > 5000) {
        lastSaveRef.current = nowT;
        savePos();
      }
    };
    const onLoaded = () => {
      const saved = useCellViewStore.getState().views[cellId];
      // 音量/倍速:瞬态优先,持久化兜底;null→不动(用元素默认 1)
      const applyAV = (v?: number | null, r?: number | null) => {
        if (v != null) m.volume = clamp(v, 0, 1);
        if (r != null) m.playbackRate = r;
      };
      if (saved?.currentTime && saved.currentTime > 0 && dur() && saved.currentTime < dur()) {
        // 瞬态优先(全界面/全屏切换回来)
        m.currentTime = saved.currentTime;
        applyAV(saved.volume, saved.rate);
        if (saved.playing) void m.play();
        sync();
        return;
      }
      // 无瞬态 → 读持久化的播放位置 + 音量/倍速续播
      void mediaPosGet(path)
        .then((p) => {
          if (p) {
            if (p.position > 0 && dur() && p.position < dur()) m.currentTime = p.position;
            applyAV(p.volume, p.rate);
          }
          // 无该文件的持久化音量 → 用设置的默认音量(§第三批,默认 30%)
          if (p?.volume == null)
            m.volume = clamp(useSettingsStore.getState().defaultVolume, 0, 1);
        })
        .catch(() => {})
        .finally(sync);
    };
    const onPause = () => savePos();
    const onErr = () => setView(cellId, { error: "无法解码/格式不受支持(WebView2 原生)" });
    // 起播时间戳(媒体并发配额"最久未起播"判据,§4.7)
    const onPlayMark = () => setView(cellId, { lastPlayAt: Date.now() });
    m.addEventListener("timeupdate", sync);
    m.addEventListener("play", sync);
    m.addEventListener("play", onPlayMark);
    m.addEventListener("pause", sync);
    m.addEventListener("pause", onPause);
    m.addEventListener("volumechange", sync);
    m.addEventListener("ratechange", sync);
    m.addEventListener("loadedmetadata", onLoaded);
    m.addEventListener("durationchange", sync);
    m.addEventListener("error", onErr);
    return () => {
      m.removeEventListener("timeupdate", sync);
      m.removeEventListener("play", sync);
      m.removeEventListener("play", onPlayMark);
      m.removeEventListener("pause", sync);
      m.removeEventListener("pause", onPause);
      m.removeEventListener("volumechange", sync);
      m.removeEventListener("ratechange", sync);
      m.removeEventListener("loadedmetadata", onLoaded);
      m.removeEventListener("durationchange", sync);
      m.removeEventListener("error", onErr);
    };
  }, [cellId, setView, file.path]);

  // 宫格关闭 / 应用退出(组件卸载)时精确保存播放位置 + 音量/倍速
  useEffect(
    () => () => {
      const p = posRef.current;
      if (p && p.d > 0) void mediaPosSet(p.path, p.t, p.d, p.v, p.r).catch(() => {});
    },
    []
  );

  // 逐帧步长:取 ffprobe 帧率(仅视频;音频不需要)
  useEffect(() => {
    if (!isVideo) return;
    let cancelled = false;
    ffprobeMeta(file.path)
      .then((m) => {
        if (!cancelled) frameRateRef.current = m.frame_rate ?? 0;
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [file.path, isVideo]);

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
            // 逐帧精确步长:1/帧率(ffprobe),未知回退 1/30
            const step = 1 / (frameRateRef.current || 30);
            m.currentTime = clamp(m.currentTime + dir * step, 0, m.duration || 0);
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

  // 播放字节来源:MIDI 等用合成出的 WAV(srcOverride),其余用原文件
  const mediaSrc = srcOverride ?? assetUrl(file.path);

  return (
    <div ref={containerRef} className="flex h-full w-full flex-col bg-black/20">
      {/* 可视区 */}
      <div
        className="relative min-h-0 flex-1 overflow-hidden"
        onClick={onToggleClick}
        style={{ cursor: active ? "pointer" : "default" }}
      >
        {isVideo ? (
          <video ref={mediaRef as React.RefObject<HTMLVideoElement>} src={mediaSrc} style={mediaStyle} playsInline />
        ) : (
          // 音频主体:文件名 + 声波可视化(§修改点2;seek 由控制条 range 条负责)
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 px-3">
            <audio ref={mediaRef as React.RefObject<HTMLAudioElement>} src={mediaSrc} />
            <div className="max-w-full truncate text-xs text-text-dim">{file.name}</div>
            <Waveform
              path={waveformPath ?? file.path}
              duration={duration}
              value={currentTime}
              height={64}
            />
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
        {isVideo ? (
          // 视频:进度条带悬停预览(M1)
          <VideoSeekBar
            path={file.path}
            duration={duration}
            value={currentTime}
            onSeek={(t) => {
              const m = mediaRef.current;
              if (m) m.currentTime = t;
            }}
          />
        ) : (
          // 音频:普通 range 进度条(§修改点2),拖动即 seek(本地文件寻址便宜)
          <SeekBar
            duration={duration}
            value={currentTime}
            live
            onSeek={(t) => {
              const m = mediaRef.current;
              if (m) m.currentTime = t;
            }}
            className="h-1 min-w-0 flex-1 accent-brand-bright"
          />
        )}
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
