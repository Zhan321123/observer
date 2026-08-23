import { FileQuestion, Clock } from "lucide-react";
import type { PreviewProps } from "../../formats/types";

/**
 * 占位视图(layout.md §8):
 * - unsupported:   暂不支持的格式
 * - ffmpeg/decode: 需要后续里程碑(FFmpeg / Rust 解码库)
 * 预览失败(解码错误/文件损坏)由 GridCell 单独渲染错误态,不走这里。
 */
export function PlaceholderView({ file, reason, strategy }: PreviewProps) {
  const isLater = strategy === "ffmpeg-stream" || strategy === "decode-rust";
  const Icon = isLater ? Clock : FileQuestion;
  const title = isLater ? "后续里程碑支持" : "暂不支持该格式";

  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-2 p-4 text-center">
      <Icon size={34} className="text-text-dim" />
      <div className="max-w-full truncate text-sm text-text">{file.name}</div>
      <div className="text-xs text-text-dim">{title}</div>
      {reason && <div className="max-w-md text-xs leading-relaxed text-text-dim/70">{reason}</div>}
    </div>
  );
}
