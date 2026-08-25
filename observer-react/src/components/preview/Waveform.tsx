import { useEffect, useRef, useState } from "react";
import { audioWaveform } from "../../lib/tauri";

// 波形峰值缓存:path → [[min,max],…](FFmpeg 解码一次,整个会话复用)
const peakCache = new Map<string, Array<[number, number]>>();

interface WaveformProps {
  path: string;
  duration: number;
  /** 当前播放时间(秒) */
  value: number;
  /** 波形高度(px) */
  height?: number;
}

const css = (name: string, fallback: string) => {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
};

/**
 * 音频波形可视化(M3):canvas 画 min/max 峰值,已播/未播分色 + 播放头。
 * 峰值来自后端 `audio_waveform`(FFmpeg 解码 → 单声道 8k s16 → 分桶峰值)。
 * 纯展示(§修改点2):宫格主体显示声波;seek 由普通 range 条(SeekBar)负责。
 * 用于原生音频(MediaCore)与流式音频(StreamAudioView)的主体可视化。
 */
export function Waveform({ path, duration, value, height = 44 }: WaveformProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [peaks, setPeaks] = useState<Array<[number, number]> | null>(
    () => peakCache.get(path) ?? null
  );
  const valueRef = useRef(value);
  valueRef.current = value;

  // 取波形峰值(整曲一次)
  useEffect(() => {
    if (peaks) return;
    let cancelled = false;
    audioWaveform(path)
      .then((p) => {
        peakCache.set(path, p);
        if (!cancelled) setPeaks(p);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [path, peaks]);

  // 绘制(峰值 / 进度 / 尺寸变化时)
  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

    const draw = () => {
      const w = wrap.clientWidth;
      const h = height;
      if (w <= 0) return;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const played = css("--color-brand-bright", "#4ea3e0");
      const rest = css("--color-text-dim", "#8a96a3");
      const mid = h / 2;
      const progress = duration > 0 ? Math.min(1, Math.max(0, valueRef.current / duration)) : 0;

      if (!peaks || peaks.length === 0) {
        // 峰值未就绪:画一条基线 + 进度
        ctx.fillStyle = rest;
        ctx.fillRect(0, mid - 0.5, w, 1);
        ctx.fillStyle = played;
        ctx.fillRect(0, mid - 0.5, w * progress, 1);
        return;
      }

      const n = peaks.length;
      const amp = mid - 1; // 留 1px 边
      for (let x = 0; x < w; x++) {
        const i = Math.min(n - 1, Math.floor((x / w) * n));
        const [mn, mx] = peaks[i];
        const y0 = mid - mx * amp;
        const y1 = mid - mn * amp;
        ctx.fillStyle = x / w <= progress ? played : rest;
        ctx.fillRect(x, y0, 1, Math.max(1, y1 - y0));
      }
      // 播放头竖线
      ctx.fillStyle = css("--color-text", "#d7dee7");
      ctx.fillRect(Math.round(w * progress), 0, 1, h);
    };

    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [peaks, duration, height, value]);

  return (
    <div ref={wrapRef} className="w-full min-w-0 select-none" style={{ height }}>
      <canvas ref={canvasRef} className="block" />
    </div>
  );
}
