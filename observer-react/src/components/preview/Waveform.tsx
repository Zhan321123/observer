import { useEffect, useRef } from "react";
import { drawPeaks } from "../../lib/waveformDraw";
import { usePeaks } from "../../hooks/usePeaks";

interface WaveformProps {
  path: string;
  duration: number;
  /** 当前播放时间(秒) */
  value: number;
  /** 波形高度(px) */
  height?: number;
}

/**
 * 音频波形可视化(M3):canvas 画 min/max 峰值,已播/未播分色 + 播放头。
 * 峰值来自后端 `audio_waveform`(FFmpeg 解码 → 单声道 8k s16 → 分桶峰值,磁盘缓存)。
 * 纯展示:宫格主体显示声波;seek 由波形进度条(WaveformSeekBar)负责。
 * 绘制逻辑与峰值加载分别抽至 lib/waveformDraw 与 hooks/usePeaks(与进度条共用)。
 * 用于原生音频(MediaCore)与流式音频(StreamAudioView)的主体可视化。
 */
export function Waveform({ path, duration, value, height = 44 }: WaveformProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { peaks } = usePeaks(path);
  const valueRef = useRef(value);
  valueRef.current = value;

  // 绘制(峰值 / 进度 / 尺寸变化时)
  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

    const draw = () => {
      const progress =
        duration > 0 ? Math.min(1, Math.max(0, valueRef.current / duration)) : 0;
      drawPeaks({
        canvas,
        width: wrap.clientWidth,
        height,
        peaks,
        progress,
        playhead: true,
      });
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
