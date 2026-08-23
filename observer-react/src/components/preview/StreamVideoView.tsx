import { useEffect, useRef, useState } from "react";
import { Play, Pause, Volume2, VolumeX } from "lucide-react";
import { streamBaseUrl, ffprobeMeta, streamUrl } from "../../lib/tauri";
import { mediaPosGet, mediaPosSet } from "../../lib/persist";
import { clamp, formatTime } from "../../lib/format";
import { useCellViewStore, type FitMode } from "../../stores/cellViewStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { registerControl } from "../../stores/cellControls";
import type { PreviewProps } from "../../formats/types";

const RATES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2];

/**
 * FFmpeg 流式视频预览(M1,method.md §3 级别 2/3):mkv/ts/mov/wmv/flv/avi/hevc 等。
 * 字节来自 loopback HTTP(remux 或实时转码的 fragmented MP4)。
 * 转码/reamux 流不能原生 seek:拖动进度 = 改 URL 的 t 参数重启(后端杀旧进程带 -ss 重起),
 * 显示时间 = startOffset(重启基点)+ 元素 currentTime;时长取自 ffprobe。
 * 交互同原生(§4.5):已选中时点击=播放/暂停,滚轮=音量。
 */
export function StreamVideoView({ file, cellId, active }: PreviewProps) {
  const mediaRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [base, setBase] = useState<string | null>(null);
  const [startOffset, setStartOffset] = useState(0);
  const [fitMode, setFitModeLocal] = useState<FitMode>("best-fit");
  const [zoom, setZoom] = useState(1);

  const offsetRef = useRef(0); // startOffset 的 ref 副本(供事件闭包读最新值)
  const durationRef = useRef(0);
  const wantPlay = useRef(false);
  // 音量/倍速持久化兜底值(loadedmetadata 时若瞬态 store 没有则用持久化的);posRef 记最新绝对位置供卸载保存
  const persistedRef = useRef<{ v: number | null; r: number | null } | null>(null);
  const posRef = useRef<{ path: string; t: number; d: number; v: number; r: number } | null>(null);
  const lastSaveRef = useRef(0);

  const setView = useCellViewStore((s) => s.setView);
  const view = useCellViewStore((s) => s.views[cellId]);
  const setFullView = useCellViewStore((s) => s.setFullView);
  const setFullScreen = useCellViewStore((s) => s.setFullScreen);

  const playing = view?.playing ?? false;
  const volume = view?.volume ?? 1;
  const rate = view?.rate ?? 1;
  const currentTime = view?.currentTime ?? 0;
  const duration = view?.duration ?? 0;
  const muted = volume === 0;

  // 流服务基址 + ffprobe 时长
  useEffect(() => {
    let cancelled = false;
    streamBaseUrl()
      .then((b) => !cancelled && setBase(b))
      .catch((e) => !cancelled && setView(cellId, { error: String(e) }));
    ffprobeMeta(file.path)
      .then((m) => {
        if (cancelled) return;
        durationRef.current = m.duration ?? 0;
        setView(cellId, { duration: durationRef.current });
      })
      .catch((e) => !cancelled && setView(cellId, { error: String(e) }));
    // 恢复持久化的播放位置(→startOffset 重启流)与音量/倍速(→loadedmetadata 时应用)
    mediaPosGet(file.path)
      .then((p) => {
        if (cancelled || !p) return;
        persistedRef.current = { v: p.volume, r: p.rate };
        if (p.position > 0 && (durationRef.current <= 0 || p.position < durationRef.current)) {
          offsetRef.current = p.position;
          setStartOffset(p.position);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [file.path, cellId, setView]);

  const src = base ? streamUrl(base, file.path, startOffset) : "";

  // 媒体事件:同步进度(绝对时间)/音量/倍率/播放态;loadedmetadata 恢复音量倍率并按需续播
  useEffect(() => {
    const m = mediaRef.current;
    if (!m) return;
    const savePos = () => {
      const abs = offsetRef.current + m.currentTime;
      if (durationRef.current > 0)
        void mediaPosSet(file.path, abs, durationRef.current, m.volume, m.playbackRate).catch(
          () => {}
        );
    };
    const sync = () => {
      const abs = offsetRef.current + m.currentTime;
      posRef.current = {
        path: file.path,
        t: abs,
        d: durationRef.current,
        v: m.volume,
        r: m.playbackRate,
      };
      setView(cellId, {
        currentTime: abs,
        duration: durationRef.current,
        volume: m.volume,
        rate: m.playbackRate,
        playing: !m.paused,
      });
      // 播放中每 ~5s 落盘一次(暂停/卸载另有精确保存)
      const nowT = Date.now();
      if (!m.paused && nowT - lastSaveRef.current > 5000) {
        lastSaveRef.current = nowT;
        savePos();
      }
    };
    const onLoaded = () => {
      const v = useCellViewStore.getState().views[cellId];
      // 瞬态优先,持久化兜底,最后用设置的默认音量(§第三批)
      m.volume = v?.volume ?? persistedRef.current?.v ?? useSettingsStore.getState().defaultVolume;
      m.playbackRate = v?.rate ?? persistedRef.current?.r ?? 1;
      if (wantPlay.current) void m.play();
      sync();
    };
    const onErr = () => {
      const err = mediaRef.current?.error;
      // MediaError.code:1 中止 2 网络/流服务 3 解码(编码不被 WebView2 支持) 4 源不支持(常被 CSP 拦截/容器无法解析)
      const reason: Record<number, string> = {
        1: "已中止",
        2: "网络/流服务异常(ffmpeg 进程退出或连接中断)",
        3: "解码失败(该编码暂不被此 WebView2 支持,如部分 AV1/HEVC)",
        4: "源不受支持(可能被 CSP 拦截或容器无法解析,请确认已重新构建应用)",
      };
      const msg = err
        ? `${reason[err.code] ?? "未知错误"}(code ${err.code}${err.message ? `:${err.message}` : ""})`
        : "需 FFmpeg,或编码暂不支持";
      setView(cellId, { error: `流式预览失败:${msg}` });
    };
    m.addEventListener("timeupdate", sync);
    m.addEventListener("play", sync);
    m.addEventListener("pause", sync);
    m.addEventListener("pause", savePos);
    m.addEventListener("volumechange", sync);
    m.addEventListener("ratechange", sync);
    m.addEventListener("loadedmetadata", onLoaded);
    m.addEventListener("error", onErr);
    return () => {
      m.removeEventListener("timeupdate", sync);
      m.removeEventListener("play", sync);
      m.removeEventListener("pause", sync);
      m.removeEventListener("pause", savePos);
      m.removeEventListener("volumechange", sync);
      m.removeEventListener("ratechange", sync);
      m.removeEventListener("loadedmetadata", onLoaded);
      m.removeEventListener("error", onErr);
    };
  }, [cellId, setView]);

  // 宫格关闭 / 应用退出(组件卸载)时精确保存播放位置 + 音量/倍速
  useEffect(
    () => () => {
      const p = posRef.current;
      if (p && p.d > 0) void mediaPosSet(p.path, p.t, p.d, p.v, p.r).catch(() => {});
    },
    []
  );

  // 滚轮调音量(仅选中格)
  useEffect(() => {
    const c = containerRef.current;
    if (!c) return;
    const onWheel = (e: WheelEvent) => {
      if (!active) return;
      e.preventDefault();
      const m = mediaRef.current;
      if (m) m.volume = clamp(m.volume + (e.deltaY < 0 ? 0.05 : -0.05), 0, 1);
    };
    c.addEventListener("wheel", onWheel, { passive: false });
    return () => c.removeEventListener("wheel", onWheel);
  }, [active]);

  /** seek 到绝对时间 t:改 startOffset 重启流(-ss) */
  const seekTo = (t: number) => {
    const m = mediaRef.current;
    wantPlay.current = m ? !m.paused : wantPlay.current;
    const c = clamp(t, 0, durationRef.current || t);
    offsetRef.current = c;
    setStartOffset(c);
  };

  // 命令式控制(功能条驱动)
  useEffect(
    () =>
      registerControl(cellId, {
        kind: "video",
        play: () => {
          wantPlay.current = true;
          void mediaRef.current?.play();
        },
        pause: () => {
          wantPlay.current = false;
          mediaRef.current?.pause();
        },
        toggle: () => {
          const m = mediaRef.current;
          wantPlay.current = m ? m.paused : !wantPlay.current;
          if (m) (m.paused ? void m.play() : m.pause());
        },
        seek: (t) => seekTo(t),
        stepFrame: (dir) => {
          const m = mediaRef.current;
          const abs = offsetRef.current + (m?.currentTime ?? 0);
          seekTo(abs + dir / 30);
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
    [cellId, setView, setFullView, setFullScreen]
  );

  const onToggleClick = () => {
    if (!active) return;
    const m = mediaRef.current;
    wantPlay.current = m ? m.paused : !wantPlay.current;
    if (m) (m.paused ? void m.play() : m.pause());
  };

  const mediaStyle: React.CSSProperties = {
    width: "100%",
    height: "100%",
    objectFit: fitMode === "actual" ? "none" : "contain",
    transform: `scale(${zoom})`,
    transformOrigin: "center center",
  };

  return (
    <div ref={containerRef} className="flex h-full w-full flex-col bg-black/20">
      <div
        className="relative min-h-0 flex-1 overflow-hidden"
        onClick={onToggleClick}
        style={{ cursor: active ? "pointer" : "default" }}
      >
        {src && <video ref={mediaRef} src={src} style={mediaStyle} playsInline />}
      </div>

      {/* 格内控制条 */}
      <div className="flex items-center gap-2 border-t border-line bg-panel px-2 py-1">
        <button
          className="text-text hover:text-brand-bright"
          onClick={() => {
            const m = mediaRef.current;
            wantPlay.current = m ? m.paused : !wantPlay.current;
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
          value={Math.min(currentTime, duration || currentTime)}
          onChange={(e) => seekTo(Number(e.target.value))}
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
