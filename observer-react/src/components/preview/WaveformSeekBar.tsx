import { useEffect, useRef, useState } from "react";
import { drawPeaks } from "../../lib/waveformDraw";
import { usePeaks } from "../../hooks/usePeaks";
import { SeekBar } from "./SeekBar";

interface WaveformSeekBarProps {
  /** 用于取音频峰值的路径(视频文件取其音轨;MIDI 用合成 WAV) */
  path: string;
  duration: number;
  value: number;
  onSeek: (t: number) => void;
  /** true=拖动即 seek(原生媒体,寻址便宜);false=松手才 seek(流式,防 ffmpeg 逐像素重启) */
  live?: boolean;
  /** 波形条高度(px) */
  height?: number;
  /** 根元素布局类(默认 flex-1 适配控制条;嵌入容器时传 h-full w-full) */
  className?: string;
}

/**
 * 波形进度条(§新增:音频/视频滚动条显示声音振幅)。
 * canvas 画峰值包络(已播/未播分色 + 播放头),上覆透明 range input 承载拖动语义
 * (键盘可达;拖动/松手提交逻辑同 SeekBar)。
 * 兜底:时长未知 / 无音频流(error)/ 全静音(silent)→ 渲染普通 SeekBar;
 * 峰值在途时画"基线 + 进度",就绪后自然变波形。
 */
export function WaveformSeekBar({
  path,
  duration,
  value,
  onSeek,
  live = true,
  height = 28,
  className,
}: WaveformSeekBarProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { peaks, error, silent } = usePeaks(path);
  const [drag, setDrag] = useState<number | null>(null);
  const shown = drag ?? (duration > 0 ? Math.min(value, duration) : value);
  const valueRef = useRef(shown);
  valueRef.current = shown;

  // 绘制(峰值 / 进度 / 尺寸变化时;进度取拖动值优先)
  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

    const draw = () => {
      const progress =
        duration > 0 ? Math.min(1, Math.max(0, valueRef.current / duration)) : 0;
      drawPeaks({ canvas, width: wrap.clientWidth, height, peaks, progress, playhead: true });
    };

    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [peaks, duration, height, shown]);

  // 无可用音轨(失败/静音)或时长未知 → 普通进度条
  if (duration <= 0 || error || silent) {
    return (
      <SeekBar
        duration={duration}
        value={value}
        onSeek={onSeek}
        live={live}
        className="h-1 min-w-0 w-full flex-1 accent-brand-bright"
      />
    );
  }

  const release = () => {
    if (drag != null && !live) onSeek(drag);
    setDrag(null);
  };

  return (
    <div
      ref={wrapRef}
      className={`relative min-w-0 ${className ?? "flex-1"}`}
      style={{ height }}
    >
      <canvas ref={canvasRef} className="block" />
      {/* 透明 range 覆盖层:原生点击/拖动/键盘语义,视觉全部交给 canvas */}
      <input
        type="range"
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        min={0}
        max={duration}
        step={0.01}
        value={shown}
        onChange={(e) => {
          const t = Number(e.target.value);
          setDrag(t);
          if (live) onSeek(t);
        }}
        onPointerDown={() => setDrag(shown)}
        onPointerUp={release}
        onKeyUp={release}
        onBlur={() => setDrag(null)}
        title="播放进度(波形)"
      />
    </div>
  );
}
