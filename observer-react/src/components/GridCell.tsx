import { X, Focus, AlertTriangle, RotateCw } from "lucide-react";
import { useGridStore } from "../stores/gridStore";
import { useCellViewStore } from "../stores/cellViewStore";
import { useDragStore } from "../stores/dragStore";
import { useContextMenuStore } from "../stores/contextMenuStore";
import { resolvePreview } from "../formats/registry";
import { startPointerDrag } from "../lib/pointerDrag";
import { fileMenuItems } from "./ContextMenu";
import type { FileRef } from "../types/file";

/**
 * 单个宫格(§4.2–4.4)。
 * - 选中:点未选中格仅改选中态(capture 阶段拦截,不触发内容操作);点已选中格才放行到内容。
 *   标题条按钮不受拦截影响,始终可点。
 * - 拖入:文件树文件、宫格间移动均通过 pointer 拖拽(dragDropEnabled=true 禁用了 HTML5 DnD,
 *   OS 拖入则走 useOsDrop 的 tauri://drag-drop);拖到本格高亮,松手覆盖/移动。
 * - 标题条:宫格号 + 文件名(右键→在资源管理器打开/复制路径)+ 刷新 / 单格展示 / 关闭。
 */
export function GridCell({ id }: { id: number }) {
  const cell = useGridStore((s) => s.cells[id]);
  const selected = useGridStore((s) => s.selected);
  const select = useGridStore((s) => s.select);
  const closeCell = useGridStore((s) => s.closeCell);
  const closeOthersSolo = useGridStore((s) => s.closeOthersSolo);
  const refreshCell = useGridStore((s) => s.refreshCell);
  const error = useCellViewStore((s) => s.views[id]?.error);
  const inFullView = useCellViewStore((s) => s.fullViewCell === id);
  // 拖拽悬停落点高亮(布尔订阅,仅本格状态变化时才重渲染)
  const isDropTarget = useDragStore((s) => s.drag != null && s.overCellId === id);

  const file = cell?.file ?? null;
  const isSelected = selected === id;

  // 选中规则:capture 拦截未选中格的内容点击
  const onClickCapture = (e: React.MouseEvent) => {
    if (!file) return;
    const inTitle = (e.target as HTMLElement).closest("[data-titlebar]");
    if (!isSelected) {
      select(id);
      if (!inTitle) {
        e.stopPropagation();
        e.preventDefault();
      }
    }
  };

  // 标题条(非按钮区域)按下 → 发起"宫格移动"拖拽
  const onTitlePointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest("button")) return; // 按钮不触发拖拽
    startPointerDrag(e, { kind: "cell", from: id });
  };

  // 标题条文件名右键 → 在资源管理器中打开 / 复制路径
  const onTitleContextMenu = (e: React.MouseEvent) => {
    if (!file) return;
    e.preventDefault();
    useContextMenuStore.getState().openMenu(e.clientX, e.clientY, fileMenuItems(file.path));
  };

  const ring = isDropTarget
    ? "border-brand-bright shadow-[inset_0_0_0_2px_var(--color-brand-bright)]"
    : isSelected
      ? "border-brand-bright shadow-[inset_0_0_0_1px_var(--color-brand-bright)]"
      : "border-line";

  return (
    <div
      data-cell-id={id}
      className={`relative flex min-h-0 min-w-0 flex-col overflow-hidden border transition-colors ${ring} bg-panel-2`}
      onClickCapture={onClickCapture}
    >
      {file && (
        <div
          data-titlebar
          className="flex h-6 shrink-0 cursor-move items-center gap-1.5 border-b border-line bg-panel px-1.5"
          onPointerDown={onTitlePointerDown}
        >
          <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded bg-panel-2 text-[10px] tabular-nums text-text-dim">
            {id + 1}
          </span>
          <span
            className="min-w-0 flex-1 truncate text-[11px] text-text-dim"
            title={file.path}
            onContextMenu={onTitleContextMenu}
          >
            {file.name}
          </span>
          <button
            className="shrink-0 rounded p-0.5 text-text-dim hover:bg-panel-2 hover:text-text"
            title="刷新(重新读取该格文件)"
            onClick={() => void refreshCell(id)}
          >
            <RotateCw size={12} />
          </button>
          <button
            className="shrink-0 rounded p-0.5 text-text-dim hover:bg-panel-2 hover:text-text"
            title="关闭其他宫格并单格展示"
            onClick={() => closeOthersSolo(id)}
          >
            <Focus size={12} />
          </button>
          <button
            className="shrink-0 rounded p-0.5 text-text-dim hover:bg-panel-2 hover:text-danger"
            title="关闭"
            onClick={() => closeCell(id)}
          >
            <X size={12} />
          </button>
        </div>
      )}

      <div className="min-h-0 flex-1">
        {!file ? (
          <div className="flex h-full w-full items-center justify-center text-[11px] text-text-dim/50">
            空格 · 点击文件或拖入
          </div>
        ) : inFullView ? (
          // 全界面/全屏显示中:预览由 FullViewOverlay 独占渲染,此格显示占位
          <div className="flex h-full w-full items-center justify-center text-[11px] text-text-dim/60">
            全屏显示中 · Esc 退出
          </div>
        ) : error ? (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 p-4 text-center">
            <AlertTriangle size={30} className="text-danger" />
            <div className="max-w-full truncate text-sm">{file.name}</div>
            <div className="text-xs text-text-dim">预览失败</div>
            <div className="max-w-md text-xs leading-relaxed text-text-dim/70">{error}</div>
          </div>
        ) : (
          <CellContent id={id} file={file} active={isSelected} />
        )}
      </div>
    </div>
  );
}

function CellContent({ id, file, active }: { id: number; file: FileRef; active: boolean }) {
  // reloadKey 变化 → 重挂载预览组件(刷新该格:文本重读 / 媒体·图片重建)
  const reloadKey = useCellViewStore((s) => s.views[id]?.reloadKey ?? 0);
  const resolved = resolvePreview(file);
  const Comp = resolved.component;
  return (
    <Comp
      key={reloadKey}
      file={file}
      cellId={id}
      active={active}
      reason={resolved.reason}
      strategy={resolved.strategy}
    />
  );
}
