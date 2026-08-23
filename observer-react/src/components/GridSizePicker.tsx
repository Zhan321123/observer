import { useEffect, useRef, useState } from "react";
import { LayoutGrid } from "lucide-react";
import { useGridStore } from "../stores/gridStore";

const MAX = 9;

/**
 * 宫格选择器(§2):仿 Word 插入表格的 m×n 悬停选择。
 * 记法 m×n = 列 × 行。悬停 (c,r) 高亮 (c+1)×(r+1) 子矩阵,点击应用。
 */
export function GridSizePicker() {
  const cols = useGridStore((s) => s.cols);
  const rows = useGridStore((s) => s.rows);
  const setGridSize = useGridStore((s) => s.setGridSize);

  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState<{ c: number; r: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // 点击外部关闭
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  const sel = hover ?? { c: cols - 1, r: rows - 1 };

  return (
    <div ref={rootRef} className="relative">
      <button
        className="flex items-center gap-1.5 rounded px-2 py-1 text-xs text-text hover:bg-panel-2"
        onClick={() => setOpen((o) => !o)}
        title="选择宫格布局"
      >
        <LayoutGrid size={15} />
        <span className="tabular-nums">
          {cols}×{rows}
        </span>
      </button>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 rounded-md border border-line bg-panel p-2 shadow-xl">
          <div
            className="grid gap-[3px]"
            style={{ gridTemplateColumns: `repeat(${MAX}, 16px)` }}
            onMouseLeave={() => setHover(null)}
          >
            {Array.from({ length: MAX * MAX }).map((_, i) => {
              const r = Math.floor(i / MAX);
              const c = i % MAX;
              const on = c <= sel.c && r <= sel.r;
              return (
                <div
                  key={i}
                  className={`h-4 w-4 rounded-[3px] border transition-colors ${
                    on ? "border-brand-bright bg-brand/60" : "border-line bg-panel-2 hover:border-text-dim"
                  }`}
                  onMouseEnter={() => setHover({ c, r })}
                  onClick={() => {
                    setGridSize(c + 1, r + 1);
                    setOpen(false);
                  }}
                />
              );
            })}
          </div>
          <div className="mt-2 text-center text-xs text-text-dim tabular-nums">
            {sel.c + 1} × {sel.r + 1}
          </div>
        </div>
      )}
    </div>
  );
}
