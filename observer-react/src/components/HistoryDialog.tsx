import { useCallback, useEffect, useState } from "react";
import { X, Trash2, History } from "lucide-react";
import { historyList, historyRemove, historyClear, type HistoryRow } from "../lib/persist";
import { fileRefFromPath } from "../hooks/useOsDrop";
import { useGridStore } from "../stores/gridStore";
import { formatBytes, formatDateTime, baseName } from "../lib/format";

interface Props {
  open: boolean;
  onClose: () => void;
}

/**
 * 预览历史(顶栏「历史」,M2 扩展):列出所有打开过的文件(含打开时间/次数),
 * 点击重开进首空格,可单条删除或一键清空。失效文件(missing)灰显不可点开。
 */
export function HistoryDialog({ open, onClose }: Props) {
  const [rows, setRows] = useState<HistoryRow[] | null>(null);
  const placeFile = useGridStore((s) => s.placeFile);

  const reload = useCallback(() => {
    historyList()
      .then(setRows)
      .catch(() => setRows([]));
  }, []);

  useEffect(() => {
    if (open) reload();
  }, [open, reload]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const onOpen = async (row: HistoryRow) => {
    if (row.missing) return;
    const ref = await fileRefFromPath(row.path);
    placeFile(ref);
    onClose();
  };
  const onRemove = async (row: HistoryRow) => {
    await historyRemove(row.path).catch(() => {});
    reload();
  };
  const onClear = async () => {
    await historyClear().catch(() => {});
    reload();
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="flex max-h-[70vh] w-[560px] flex-col rounded-lg border border-line bg-panel shadow-2xl">
        <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
          <h2 className="flex items-center gap-2 text-sm font-medium">
            <History size={15} className="text-text-dim" />
            预览历史
          </h2>
          <div className="flex items-center gap-2">
            <button
              className="rounded px-2 py-1 text-xs text-danger hover:bg-panel-2 disabled:opacity-40"
              onClick={onClear}
              disabled={!rows || rows.length === 0}
              title="清空历史记录"
            >
              清空历史记录
            </button>
            <button className="text-text-dim hover:text-text" onClick={onClose} title="关闭">
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {rows == null ? (
            <div className="p-4 text-xs text-text-dim">加载中…</div>
          ) : rows.length === 0 ? (
            <div className="p-4 text-xs text-text-dim">暂无浏览记录</div>
          ) : (
            rows.map((r) => (
              <div
                key={r.path}
                className={`group flex items-center gap-2 border-b border-line/50 px-4 py-2 ${
                  r.missing ? "opacity-45" : "cursor-pointer hover:bg-panel-2"
                }`}
                onClick={() => void onOpen(r)}
                title={r.missing ? `${r.path}(文件已不存在)` : r.path}
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs text-text">
                    {baseName(r.path)}
                    {r.missing && <span className="ml-2 text-danger">已失效</span>}
                  </div>
                  <div className="truncate text-[11px] text-text-dim/70">{r.path}</div>
                </div>
                <div className="shrink-0 text-right text-[11px] tabular-nums text-text-dim">
                  <div>{formatDateTime(r.last_opened)}</div>
                  <div className="text-text-dim/60">
                    {formatBytes(r.size)} · {r.open_count} 次
                  </div>
                </div>
                <button
                  className="shrink-0 rounded p-1 text-text-dim opacity-0 hover:bg-panel hover:text-danger group-hover:opacity-100"
                  title="删除该记录"
                  onClick={(e) => {
                    e.stopPropagation();
                    void onRemove(r);
                  }}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
