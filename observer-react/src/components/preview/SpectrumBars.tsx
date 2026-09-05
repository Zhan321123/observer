import { useEffect, useRef } from "react";
import { cssVar } from "../../lib/waveformDraw";

interface SpectrumBarsProps {
  analyser: AnalyserNode | null;
  /** 柱数(对数频段),默认 48 */
  bars?: number;
  className?: string;
}

/**
 * 实时频谱柱形图(§交互升级:静态频谱图 → 随音乐跳动的柱形频谱分析仪)。
 * AnalyserNode.getByteFrequencyData → 按对数频段(20Hz..16kHz)聚合为 N 柱;
 * 上升立即跟随、下降平滑衰减(视觉自然);静音/暂停落到 2px 基准柱。
 * analyser 为 null(未就绪/Web Audio 不可用)时显示静态基准,不报错。
 */
export function SpectrumBars({ analyser, bars = 48, className }: SpectrumBarsProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // 每柱当前高度(0..1,带下降平滑;ref 存,不触发 React 渲染)
  const levelsRef = useRef<number[]>(new Array(bars).fill(0));

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const g = canvas.getContext("2d");
    if (!g) return;

    const levels = levelsRef.current;
    while (levels.length < bars) levels.push(0);
    levels.length = bars;

    const data = analyser ? new Uint8Array(analyser.frequencyBinCount) : null;
    // 对数频段:20Hz .. min(16kHz, 奈奎斯特)
    const fMin = 20;
    const fMax = analyser ? Math.min(16000, analyser.context.sampleRate / 2) : 16000;

    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const w = wrap.clientWidth;
      const h = wrap.clientHeight;
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

      if (analyser && data) {
        analyser.getByteFrequencyData(data);
        const binHz = analyser.context.sampleRate / 2 / data.length;
        for (let i = 0; i < bars; i++) {
          // 第 i 柱覆盖对数频段 [f0, f1) 的最大 bin
          const f0 = fMin * Math.pow(fMax / fMin, i / bars);
          const f1 = fMin * Math.pow(fMax / fMin, (i + 1) / bars);
          const b0 = Math.floor(f0 / binHz);
          const b1 = Math.max(b0 + 1, Math.ceil(f1 / binHz));
          let m = 0;
          for (let b = b0; b < Math.min(b1, data.length); b++) m = Math.max(m, data[b]);
          const target = m / 255;
          levels[i] = target > levels[i] ? target : levels[i] * 0.82 + target * 0.18;
        }
      } else {
        for (let i = 0; i < bars; i++) levels[i] *= 0.85;
      }

      // 柱形:底对齐,主题色纵向渐变;静音时 2px 基准
      const gap = Math.max(1, (w / bars) * 0.3);
      const bw = (w - gap * (bars - 1)) / bars;
      const grad = g.createLinearGradient(0, h, 0, 0);
      grad.addColorStop(0, cssVar("--color-brand", "#2c5f8a"));
      grad.addColorStop(1, cssVar("--color-brand-bright", "#4ea3e0"));
      g.fillStyle = grad;
      for (let i = 0; i < bars; i++) {
        const bh = Math.max(2, levels[i] * (h - 2));
        g.fillRect(i * (bw + gap), h - bh, bw, bh);
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [analyser, bars]);

  return (
    <div ref={wrapRef} className={`min-h-0 w-full flex-1 ${className ?? ""}`}>
      <canvas ref={canvasRef} className="block h-full w-full" />
    </div>
  );
}
