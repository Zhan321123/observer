import { X } from "lucide-react";
import { useGridStore } from "../stores/gridStore";
import { useContextMenuStore } from "../stores/contextMenuStore";
import { fileMenuItems } from "./ContextMenu";

/**
 * 打开的文件列表(§3.4):当前所有宫格中打开的文件的绝对路径。
 * 拖进宫格的文件可能不在当前文件夹里,此列表是找到它们的唯一地方。
 * 点击列表项 = 选中对应宫格;右侧 × = 关闭对应宫格;右键 = 资源管理器打开/复制路径。
 */
export function OpenedFilesList() {
  const cells = useGridStore((s) => s.cells);
  const selected = useGridStore((s) => s.selected);
  const select = useGridStore((s) => s.select);
  const closeCell = useGridStore((s) => s.closeCell);

  const opened = cells.filter((c) => c.file);
  if (opened.length === 0) return null;

  return (
    <div className="border-t border-line">
      <div className="px-2 py-1 text-[11px] font-medium uppercase tracking-wide text-text-dim">
        打开的文件
      </div>
      <div className="max-h-40 overflow-y-auto pb-1">
        {opened.map((c) => (
          <div
            key={c.id}
            className={`group flex items-center gap-1 pr-1 ${
              selected === c.id ? "bg-brand/20" : "hover:bg-panel-2"
            }`}
          >
            <button
              className={`min-w-0 flex-1 truncate px-3 py-1 text-left text-[11px] ${
                selected === c.id ? "text-text" : "text-text-dim"
              }`}
              onClick={() => select(c.id)}
              onContextMenu={(e) => {
                e.preventDefault();
                useContextMenuStore
                  .getState()
                  .openMenu(e.clientX, e.clientY, fileMenuItems(c.file!.path));
              }}
              title={c.file!.path}
            >
              {c.file!.path}
            </button>
            <button
              className="shrink-0 rounded p-0.5 text-text-dim opacity-0 hover:bg-panel hover:text-danger group-hover:opacity-100"
              title="关闭该宫格"
              onClick={() => closeCell(c.id)}
            >
              <X size={12} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
