import { useEffect, useRef, useState } from "react";
import { Play, Pause, Volume2, VolumeX } from "lucide-react";
import { streamBaseUrl, ffprobeMeta, streamUrl } from "../../lib/tauri";
import { mediaPosGet, mediaPosSet } from "../../lib/persist";
import { clamp, formatTime } from "../../lib/format";
import { useCellViewStore } from "../../stores/cellViewStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { registerControl } from "../../stores/cellControls";
import { Waveform } from "./Waveform";
import { SeekBar } from "./SeekBar";
import type { PreviewProps } from "../../formats/types";

const RATES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2];

/**
 * 非常规音频流式预览(M3):ape/wv/tta/wma/aiff/dsf 等 WebView 不原生支持的格式。
 * 复用 M1 loopback:ffmpeg demux/decode → AAC fMP4,经 127.0.0.1 HTTP 流出(铁律 2)。
 * 不能原生 seek:拖动 = 改 URL 的 t 参数重启(-ss 重起);显示时间 = startOffset + currentTime。
 * 波形(Waveform)既是可视化也是 seek 控件;播放位置/音量/倍速经 media_position 持久化。
 */
export function StreamAudioView({ file, cellId, active }: PreviewProps) {
  const mediaRef = useRef<HTMLAudioElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [base, setBase] = useState<string | null>(null);
  const [startOffset, setStartOffset] = useState(0);

  const offsetRef = useRef(0);
  const durationRef = useRef(0);
  const wantPlay = useRef(false);
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

  // 流服务基址 + ffprobe 时长 + 恢复持久化进度
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

  // 媒体事件 → store;loadedmetadata 恢复音量/倍速并按需续播
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
      const nowT = Date.now();
      if (!m.paused && nowT - lastSaveRef.current > 5000) {
        lastSaveRef.current = nowT;
        savePos();
      }
    };
    const onLoaded = () => {
      const v = useCellViewStore.getState().views[cellId];
      m.volume = v?.volume ?? persistedRef.current?.v ?? useSettingsStore.getState().defaultVolume;
      m.playbackRate = v?.rate ?? persistedRef.current?.r ?? 1;
      if (wantPlay.current) void m.play();
      sync();
    };
    const onErr = () => {
      const err = mediaRef.current?.error;
      const reason: Record<number, string> = {
        1: "已中止",
        2: "网络/流服务异常(ffmpeg 进程退出或连接中断)",
        3: "解码失败(FFmpeg 转码异常)",
        4: "源不受支持(可能被 CSP 拦截或容器无法解析)",
      };
      const msg = err ? `${reason[err.code] ?? "未知错误"}(code ${err.code})` : "需 FFmpeg";
      setView(cellId, { error: `流式音频预览失败:${msg}` });
    };
    const onPlayMark = () => setView(cellId, { lastPlayAt: Date.now() });
    m.addEventListener("timeupdate", sync);
    m.addEventListener("play", sync);
    m.addEventListener("play", onPlayMark);
    m.addEventListener("pause", sync);
    m.addEventListener("pause", savePos);
    m.addEventListener("volumechange", sync);
    m.addEventListener("ratechange", sync);
    m.addEventListener("loadedmetadata", onLoaded);
    m.addEventListener("error", onErr);
    return () => {
      m.removeEventListener("timeupdate", sync);
      m.removeEventListener("play", sync);
      m.removeEventListener("play", onPlayMark);
      m.removeEventListener("pause", sync);
      m.removeEventListener("pause", savePos);
      m.removeEventListener("volumechange", sync);
      m.removeEventListener("ratechange", sync);
      m.removeEventListener("loadedmetadata", onLoaded);
      m.removeEventListener("error", onErr);
    };
  }, [cellId, setView]);

  // 卸载时精确保存进度
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
        kind: "audio",
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
        setVolume: (v) => {
          const m = mediaRef.current;
          if (m) m.volume = clamp(v, 0, 1);
        },
        setRate: (r) => {
          const m = mediaRef.current;
          if (m) m.playbackRate = r;
        },
        enterFullView: () => setFullView(cellId),
        enterFullScreen: () => {
          setFullView(cellId);
          setFullScreen(true);
        },
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cellId, setView, setFullView, setFullScreen]
  );

  const togglePlay = () => {
    const m = mediaRef.current;
    wantPlay.current = m ? m.paused : !wantPlay.current;
    if (m) (m.paused ? void m.play() : m.pause());
  };

  return (
    <div ref={containerRef} className="flex h-full w-full flex-col bg-black/20">
      {/* 波形可视区(§修改点2:纯展示;seek 由控制条 range 条负责) */}
      <div className="relative flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-3">
        {src && <audio ref={mediaRef} src={src} />}
        <div className="max-w-full truncate text-xs text-text-dim">{file.name}</div>
        <div className="w-full">
          <Waveform
            path={file.path}
            duration={duration}
            value={Math.min(currentTime, duration || currentTime)}
            height={56}
          />
        </div>
      </div>

      {/* 格内控制条 */}
      <div className="flex items-center gap-2 border-t border-line bg-panel px-2 py-1">
        <button
          className="text-text hover:text-brand-bright"
          onClick={togglePlay}
          title={playing ? "暂停" : "播放"}
        >
          {playing ? <Pause size={15} /> : <Play size={15} />}
        </button>
        <span className="shrink-0 text-[11px] tabular-nums text-text-dim">
          {formatTime(currentTime)} / {formatTime(duration)}
        </span>
        {/* 普通 range 进度条(§修改点2):流式 seek = 改 startOffset 重启流,故松手才跳(live=false) */}
        <SeekBar
          duration={duration}
          value={currentTime}
          live={false}
          onSeek={seekTo}
          className="h-1 min-w-0 flex-1 accent-brand-bright"
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
