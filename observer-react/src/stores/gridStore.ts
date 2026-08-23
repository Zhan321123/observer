import { create } from "zustand";
import type { FileRef } from "../types/file";
import { useCellViewStore } from "./cellViewStore";

/**
 * 宫格状态机(layout.md §4.1–4.4)。
 * - 记法 m×n = 列 × 行(§4.1:"2×2 调成 1×2 保留第 1、3 格(第一列)")。
 * - cells 行优先存储:index = row*cols + col,宫格号 = index+1。
 * - 缩容只保留左上角子矩阵(实现:仅复制 row<newRows && col<newCols 的旧格)。
 * - 视图态(播放位置/缩放等,cellViewStore)按 cellId 存,在文件变更/关格/缩容时清理;
 *   全界面切换不动它,因此切换后媒体位置得以保留。
 */
export interface CellState {
  id: number;
  file: FileRef | null;
}

const emptyCells = (n: number): CellState[] =>
  Array.from({ length: n }, (_, i) => ({ id: i, file: null }));

const clearView = (id: number) => useCellViewStore.getState().clearView(id);
const clearAllViews = () =>
  Object.keys(useCellViewStore.getState().views).forEach((k) => clearView(Number(k)));

interface GridState {
  cols: number;
  rows: number;
  cells: CellState[];
  /** 全局唯一选中格 index;全空时为 null */
  selected: number | null;

  setGridSize(cols: number, rows: number): void;
  /** 单击文件:进第一个空格;无空格则覆盖 0 号格 */
  placeFile(file: FileRef): void;
  /** 拖拽到指定格:强制覆盖 */
  placeFileAt(index: number, file: FileRef): void;
  /** 格间拖拽:A→B 覆盖 B,A 变空白 */
  moveCell(from: number, to: number): void;
  closeCell(index: number): void;
  /** 关闭其他格并单格展示(→1×1 仅留本格) */
  closeOthersSolo(index: number): void;
  select(index: number | null): void;
}

function firstFilledIndex(cells: CellState[]): number | null {
  const i = cells.findIndex((c) => c.file);
  return i >= 0 ? i : null;
}

export const useGridStore = create<GridState>((set, get) => ({
  cols: 1,
  rows: 1,
  cells: emptyCells(1),
  selected: null,

  setGridSize: (cols, rows) =>
    set((s) => {
      const cells = emptyCells(cols * rows);
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (r < s.rows && c < s.cols) {
            const old = s.cells[r * s.cols + c];
            if (old) cells[r * cols + c] = { id: r * cols + c, file: old.file };
          }
        }
      }
      // 缩容/扩容后 cellId 会重排,瞬态视图态(播放位置等)随之重置
      clearAllViews();
      let selected = s.selected;
      if (selected != null) {
        const sr = Math.floor(selected / s.cols);
        const sc = selected % s.cols;
        const kept = sr < rows && sc < cols ? cells[sr * cols + sc] : undefined;
        selected = kept?.file ? sr * cols + sc : null;
      }
      // 全部空白 → 无选中;否则保证有选中格
      if (selected == null) selected = firstFilledIndex(cells);
      return { cols, rows, cells, selected };
    }),

  placeFile: (file) => {
    const s = get();
    const firstEmpty = s.cells.findIndex((c) => !c.file);
    get().placeFileAt(firstEmpty >= 0 ? firstEmpty : 0, file);
  },

  placeFileAt: (index, file) =>
    set((s) => {
      clearView(index);
      const cells = s.cells.slice();
      cells[index] = { id: index, file };
      return { cells, selected: index };
    }),

  moveCell: (from, to) =>
    set((s) => {
      if (from === to || !s.cells[from]?.file) return {};
      clearView(from);
      clearView(to);
      const cells = s.cells.slice();
      cells[to] = { id: to, file: cells[from].file };
      cells[from] = { id: from, file: null };
      return { cells, selected: to };
    }),

  closeCell: (index) =>
    set((s) => {
      clearView(index);
      const cells = s.cells.slice();
      cells[index] = { id: index, file: null };
      let selected = s.selected === index ? null : s.selected;
      if (!cells.some((c) => c.file)) selected = null;
      else if (selected == null) selected = firstFilledIndex(cells);
      return { cells, selected };
    }),

  closeOthersSolo: (index) =>
    set((s) => {
      const file = s.cells[index]?.file ?? null;
      // 保留被保留格的视图态:从 index 搬到 0,清掉其余
      const keptView = useCellViewStore.getState().views[index];
      clearAllViews();
      if (keptView) useCellViewStore.getState().setView(0, keptView);
      return {
        cols: 1,
        rows: 1,
        cells: [{ id: 0, file }],
        selected: file ? 0 : null,
      };
    }),

  select: (index) =>
    set((s) => {
      const anyFilled = s.cells.some((c) => c.file);
      if (!anyFilled) return { selected: null };
      if (index != null && s.cells[index]?.file) return { selected: index };
      return { selected: s.selected ?? firstFilledIndex(s.cells) };
    }),
}));
