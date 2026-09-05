import { useEffect, useRef } from "react";
import { cssVar } from "../../lib/waveformDraw";
import { usePeaks } from "../../hooks/usePeaks";
import { clamp } from "../../lib/format";

interface ScrollWaveformProps {
  path: string;
  duration: number;
  /** 当前播放时间(秒) */
  value: number;
  onSeek?: (t: number) => void;
  /** 高度(px);缺省撑满容器 */
  height?: number;
}

/**
 * 实时滚动波形(§交互升级:静态整曲波形 → 拉长滚动)。
 * 整曲峰值按 ≥24px/s 拉成虚拟长条(整曲至少 6 倍视口宽),播放头固定在视口 30% 处,
 * 播放时波形向左滚过;自适应时间网格线(秒/分);点击任意位置 = seek 到该时刻。
 * 峰值复用 usePeaks(后端 4096 桶磁盘缓存);未就绪时画基线 + 网格,不阻塞。
 */
export function ScrollWaveform({ path, duration, value, onSeek, height }: ScrollWaveformProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { peaks } = usePeaks(path);
  // 视口偏移在 rAF 里自算自绘(每 timeupdate 重渲染太贵),点击时读最近值
  const stateRef = useRef({ value, offset: 0, pxPerSec: 0 });
  stateRef.current.value = value;

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const g = canvas.getContext("2d");
    if (!g) return;

    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const w = wrap.clientWidth;
      const h = height ?? wrap.clientHeight;
      if (w <= 0 || h <= 0) return;
      const dpr = window.devicePixelRatio || 1;
      const pw = Math.round(w * dpr);
      const ph = Math.round(h * dpr);
      if (canvas.width !== pw) {
        canvas.width = pw;
        canvas.style.width = `${w}px`;
      }
      if (canvas.height !== ph) {
        canvas.height = ph;
        canvas.style.height = `${h}px`;
      }
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);

      const played = cssVar("--color-brand-bright", "#4ea3e0");
      const rest = cssVar("--color-text-dim", "#8a96a3");
      const grid = cssVar("--color-line", "#2a323c");
      const mid = h / 2;

      // 拉长:整曲至少铺满 6 倍视口宽,且至少 24px/s(短文件不过度稀疏)
      const dur = Math.max(duration, 0.01);
      const pxPerSec = Math.max(24, (w * 6) / dur);
      const anchor = w * 0.3; // 播放头固定位置
      const totalPx = dur * pxPerSec;
      const offset = clamp(stateRef.current.value * pxPerSec - anchor, 0, Math.max(0, totalPx - w));
      stateRef.current.offset = offset;
      stateRef.current.pxPerSec = pxPerSec;
      const cur = stateRef.current.value;

      // 自适应时间网格线:取第一个 ≥64px 的间隔
      const steps = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
      const step = steps.find((s) => s * pxPerSec >= 64) ?? 900;
      g.strokeStyle = grid;
      g.fillStyle = rest;
      g.font = "9px system-ui, sans-serif";
      g.lineWidth = 1;
      const tFirst = Math.ceil(offset / pxPerSec / step) * step;
      for (let t = tFirst; t * pxPerSec <= offset + w && t <= dur; t += step) {
        const x = Math.round(t * pxPerSec - offset) + 0.5;
        g.globalAlpha = 0.5;
        g.beginPath();
        g.moveTo(x, 0);
        g.lineTo(x, h);
        g.stroke();
        g.globalAlpha = 0.7;
        g.fillText(formatTick(t, step), x + 2, h - 2);
        g.globalAlpha = 1;
      }

      // 波形列:每像素列 → 时间 → 峰值桶
      const n = peaks?.length ?? 0;
      if (n > 0) {
        const amp = mid - 1;
        for (let x = 0; x < w; x++) {
          const t = (offset + x) / pxPerSec;
          if (t > dur) break;
          const i = Math.min(n - 1, Math.floor((t / dur) * n));
          const [mn, mx] = peaks![i];
          const y0 = mid - mx * amp;
          const y1 = mid - mn * amp;
          g.fillStyle = t <= cur ? played : rest;
          g.fillRect(x, y0, 1, Math.max(1, y1 - y0));
        }
      } else {
        // 峰值未就绪:基线
        g.fillStyle = rest;
        g.fillRect(0, mid - 0.5, w, 1);
      }

      // 播放头(视口 30% 处的常驻竖线)
      g.fillStyle = cssVar("--color-text", "#d7dee7");
      g.fillRect(Math.round(anchor), 0, 1, h);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [peaks, duration, height]);

  const onClick = (e: React.MouseEvent) => {
    if (!onSeek || duration <= 0) return;
    const el = wrapRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = clamp(e.clientX - rect.left, 0, rect.width);
    const t = (stateRef.current.offset + x) / (stateRef.current.pxPerSec || 1);
    onSeek(clamp(t, 0, duration));
  };

  return (
    <div
      ref={wrapRef}
      className={`min-h-0 w-full flex-1 select-none ${onSeek ? "cursor-pointer" : ""}`}
      onClick={onClick}
    >
      <canvas ref={canvasRef} className="block h-full w-full" />
    </div>
  );
}

/** 网格刻度文本:≥60s 用 m:ss,否则纯秒 */
function formatTick(t: number, step: number): string {
  if (step < 60) return `${t}s`;
  const m = Math.floor(t / 60);
  const s = Math.round(t % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}
