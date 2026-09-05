/**
 * 波形 canvas 绘制(Waveform 主体 / WaveformSeekBar 进度条共用)。
 * 从 Waveform.tsx 抽出:峰值包络 + 已播/未播分色 + 播放头;DPR 感知。
 */

export type Peaks = Array<[number, number]>;

/** 读 CSS 变量(主题色),取不到用 fallback */
export function cssVar(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

/**
 * 画一帧波形到 canvas(自动按 DPR 设定画布尺寸)。
 * peaks 为 null/空时画"基线 + 进度"(峰值未就绪/加载失败的兜底形态)。
 */
export function drawPeaks(opts: {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  peaks: Peaks | null;
  /** 0..1 播放进度 */
  progress: number;
  /** 是否画播放头竖线 */
  playhead?: boolean;
}): void {
  const { canvas, width: w, height: h, peaks, progress, playhead = true } = opts;
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

  const played = cssVar("--color-brand-bright", "#4ea3e0");
  const rest = cssVar("--color-text-dim", "#8a96a3");
  const mid = h / 2;
  const p = Math.min(1, Math.max(0, progress));

  if (!peaks || peaks.length === 0) {
    // 峰值未就绪:基线 + 进度
    ctx.fillStyle = rest;
    ctx.fillRect(0, mid - 0.5, w, 1);
    ctx.fillStyle = played;
    ctx.fillRect(0, mid - 0.5, w * p, 1);
    return;
  }

  const n = peaks.length;
  const amp = mid - 1; // 留 1px 边
  for (let x = 0; x < w; x++) {
    const i = Math.min(n - 1, Math.floor((x / w) * n));
    const [mn, mx] = peaks[i];
    const y0 = mid - mx * amp;
    const y1 = mid - mn * amp;
    ctx.fillStyle = x / w <= p ? played : rest;
    ctx.fillRect(x, y0, 1, Math.max(1, y1 - y0));
  }
  if (playhead) {
    ctx.fillStyle = cssVar("--color-text", "#d7dee7");
    ctx.fillRect(Math.round(w * p), 0, 1, h);
  }
}
