import { ArrowLeftRight } from "lucide-react";

/** 格式转换 frame(§7):本版本仅占位"暂不可用"(架构已按 design.md §10 预留)。 */
export function ConvertPanel() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 bg-panel p-4 text-center">
      <ArrowLeftRight size={26} className="text-text-dim/60" />
      <div className="text-sm text-text-dim">暂不可用</div>
      <div className="max-w-xs text-[11px] leading-relaxed text-text-dim/60">
        格式转换将在后续版本提供 —— 与预览共用同一 Job 引擎(design.md §10,里程碑 M5)。
      </div>
    </div>
  );
}
