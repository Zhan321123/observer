import { useEffect, useRef, useState } from "react";
import { videoThumbnail, assetUrl, allowAssetPath } from "../../lib/tauri";
import { formatTime } from "../../lib/format";

// 进度条悬停缩略图缓存:`${path}@${秒}` → asset URL(与后端按秒分桶的磁盘缓存对应)。
const thumbCache = new Map<string, string>();

interface VideoSeekBarProps {
  /** 视频路径(悬停取帧用) */
  path: string;
  duration: number;
  value: number;
  onSeek: (t: number) => void;
}

/**
 * 视频进度条(带悬停预览,M1"进度条缩略图"):拖动=seek,悬停=显示该时间点海报帧 + 时间。
 * 悬停帧经 `video_thumbnail(path, 秒)` 生成(后端按秒分桶磁盘缓存);取帧按 90ms 防抖,
 * 避免快速划过时每像素都拉起 ffmpeg。
 */
export function VideoSeekBar({ path, duration, value, onSeek }: VideoSeekBarProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ x: number; t: number } | null>(null);
  const [thumb, setThumb] = useState<string | null>(null);
  const fetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 卸载清防抖
  useEffect(
    () => () => {
      if (fetchTimer.current) clearTimeout(fetchTimer.current);
    },
    []
  );

  const onMove = (e: React.MouseEvent) => {
    const el = wrapRef.current;
    if (!el || duration <= 0) return;
    const rect = el.getBoundingClientRect();
    const x = Math.min(rect.width, Math.max(0, e.clientX - rect.left));
    const t = (x / rect.width) * duration;
    setHover({ x, t });

    const bucket = Math.round(t);
    const key = `${path}@${bucket}`;
    const cached = thumbCache.get(key);
    if (cached) {
      setThumb(cached);
      return;
    }
    // 防抖取帧:鼠标停顿 90ms 才调 ffmpeg(快速划过不反复拉进程)
    if (fetchTimer.current) clearTimeout(fetchTimer.current);
    fetchTimer.current = setTimeout(() => {
      void (async () => {
        try {
          const png = await videoThumbnail(path, bucket);
          await allowAssetPath(png).catch(() => {});
          const u = assetUrl(png);
          thumbCache.set(key, u);
          // 仅在仍悬停同一时间桶时更新,避免错帧
          setHover((h) => {
            if (h && Math.round(h.t) === bucket) setThumb(u);
            return h;
          });
        } catch {
          // 该时间点取帧失败 → 不显示缩略图(仅时间)
        }
      })();
    }, 90);
  };

  const onLeave = () => {
    setHover(null);
    if (fetchTimer.current) clearTimeout(fetchTimer.current);
  };

  return (
    <div ref={wrapRef} className="relative min-w-0 flex-1" onMouseMove={onMove} onMouseLeave={onLeave}>
      {hover && (
        <div
          className="pointer-events-none absolute bottom-full z-20 mb-1.5 -translate-x-1/2 overflow-hidden rounded border border-line bg-black/90 shadow-lg"
          style={{ left: hover.x }}
        >
          {thumb && <img src={thumb} alt="" draggable={false} className="h-16 w-28 object-cover" />}
          <div className="px-1 py-0.5 text-center text-[10px] tabular-nums text-white/85">
            {formatTime(hover.t)}
          </div>
        </div>
      )}
      <input
        type="range"
        className="h-1 w-full accent-brand-bright"
        min={0}
        max={duration || 0}
        step={0.01}
        value={value}
        onChange={(e) => onSeek(Number(e.target.value))}
      />
    </div>
  );
}
