import { useGridStore } from "../stores/gridStore";

/**
 * 打开的文件列表(§3.4):当前所有宫格中打开的文件的绝对路径。
 * 拖进宫格的文件可能不在当前文件夹里,此列表是找到它们的唯一地方。
 * 点击列表项 = 选中对应宫格。
 */
export function OpenedFilesList() {
  const cells = useGridStore((s) => s.cells);
  const selected = useGridStore((s) => s.selected);
  const select = useGridStore((s) => s.select);

  const opened = cells.filter((c) => c.file);
  if (opened.length === 0) return null;

  return (
    <div className="border-t border-line">
      <div className="px-2 py-1 text-[11px] font-medium uppercase tracking-wide text-text-dim">
        打开的文件
      </div>
      <div className="max-h-40 overflow-y-auto pb-1">
        {opened.map((c) => (
          <button
            key={c.id}
            className={`block w-full truncate px-3 py-1 text-left text-[11px] ${
              selected === c.id ? "bg-brand/20 text-text" : "text-text-dim hover:bg-panel-2"
            }`}
            onClick={() => select(c.id)}
            title={c.file!.path}
          >
            {c.file!.path}
          </button>
        ))}
      </div>
    </div>
  );
}
