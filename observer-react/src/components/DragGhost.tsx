import { File as FileIcon, LayoutGrid } from "lucide-react";
import { useDragStore } from "../stores/dragStore";

/** 内部拖拽的跟随游标(pointer-events:none,不挡 elementFromPoint 命中)。 */
export function DragGhost() {
  const drag = useDragStore((s) => s.drag);
  const x = useDragStore((s) => s.x);
  const y = useDragStore((s) => s.y);

  if (!drag) return null;

  return (
    <div
      className="pointer-events-none fixed z-[200] flex items-center gap-1.5 rounded border border-brand-bright bg-panel px-2 py-1 text-xs text-text shadow-xl"
      style={{ left: x + 12, top: y + 12 }}
    >
      {drag.kind === "file" ? <FileIcon size={13} /> : <LayoutGrid size={13} />}
      <span className="max-w-[220px] truncate">
        {drag.kind === "file" ? drag.name : `宫格 ${drag.from + 1}`}
      </span>
    </div>
  );
}
