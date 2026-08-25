import { useState } from "react";

interface SeekBarProps {
  /** 总时长(秒);<=0 时禁用 */
  duration: number;
  /** 当前播放时间(秒) */
  value: number;
  onSeek: (t: number) => void;
  /** true=拖动即 seek(本地文件,寻址便宜);false=松手才 seek(流式,避免频繁重启流) */
  live?: boolean;
  className?: string;
}

/**
 * 普通 range 进度条(§修改点2):替代原"波形即 seek 控件",音频格内 seek 统一用它。
 * 拖动中以本地值 drag 为准显示,避免播放中 timeupdate 回写与拖动手感打架;
 * 本地文件(live)边拖边 seek,流式(非 live)松手(onPointerUp/onKeyUp)才 seek。
 */
export function SeekBar({ duration, value, onSeek, live = true, className }: SeekBarProps) {
  const [drag, setDrag] = useState<number | null>(null);
  const shown = drag ?? (duration > 0 ? Math.min(value, duration) : value);

  // 松手/按键结束:流式(非 live)在此才提交 seek;live 已在 onChange 提交,仅清拖动态
  const release = () => {
    if (drag != null && !live) onSeek(drag);
    setDrag(null);
  };

  return (
    <input
      type="range"
      className={className}
      min={0}
      max={duration > 0 ? duration : 0.01}
      step={0.01}
      value={shown}
      disabled={duration <= 0}
      onPointerDown={() => setDrag(shown)}
      onChange={(e) => {
        const t = Number(e.target.value);
        setDrag(t);
        if (live) onSeek(t);
      }}
      onPointerUp={release}
      onKeyUp={release}
      onBlur={() => setDrag(null)}
      title="播放进度"
    />
  );
}
