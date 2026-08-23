import { create } from "zustand";

/**
 * 内部拖拽状态(pointer-based)。
 * 背景:tauri.conf 的 dragDropEnabled=true 用于 OS 拖入拿绝对路径,但会禁用页面内 HTML5 DnD。
 * 因此"文件树→宫格""宫格→宫格"改用 pointer 事件自实现,不走 HTML5 DnD。
 */
export type DragData =
  | { kind: "file"; path: string; name: string; ext: string }
  | { kind: "cell"; from: number };

interface DragState {
  /** 进行中的拖拽(null=无) */
  drag: DragData | null;
  x: number;
  y: number;
  /** 当前悬停的宫格 id(用于落点高亮;null=不在任何宫格上) */
  overCellId: number | null;

  begin(d: DragData, x: number, y: number): void;
  move(x: number, y: number, overCellId: number | null): void;
  end(): void;
}

export const useDragStore = create<DragState>((set) => ({
  drag: null,
  x: 0,
  y: 0,
  overCellId: null,
  begin: (drag, x, y) => set({ drag, x, y }),
  move: (x, y, overCellId) => set({ x, y, overCellId }),
  end: () => set({ drag: null, overCellId: null }),
}));
