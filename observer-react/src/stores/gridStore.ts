import { create } from "zustand";
import type { FileRef } from "../types/file";
import { useCellViewStore } from "./cellViewStore";
import { useSettingsStore } from "./settingsStore";
import { detectFormat } from "../lib/tauri";
import { historyOpen } from "../lib/persist";

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

/** sequential 覆盖策略的轮转游标(不持久化,会话内从 0 开始) */
let seqCursor = 0;

interface GridState {
  cols: number;
  rows: number;
  cells: CellState[];
  /** 全局唯一选中格 index;全空时为 null */
  selected: number | null;

  setGridSize(cols: number, rows: number): void;
  /** 单击文件:进第一个空格;无空格则按 gridFullPolicy 覆盖策略选格 */
  placeFile(file: FileRef): void;
  /** 拖拽到指定格:强制覆盖 */
  placeFileAt(index: number, file: FileRef): void;
  /** 格间拖拽:A→B 覆盖 B,A 变空白 */
  moveCell(from: number, to: number): void;
  closeCell(index: number): void;
  /** 关闭其他格并单格展示(→1×1 仅留本格) */
  closeOthersSolo(index: number): void;
  /** 刷新该格:重新 detect_format + 自增 reloadKey 触发预览重读/重建 */
  refreshCell(index: number): Promise<void>;
  select(index: number | null): void;
  /** 启动还原(M2 持久化):整体设置布局 + 各格文件 + 选中格 */
  hydrate(state: { cols: number; rows: number; cells: CellState[]; selected: number | null }): void;
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
    if (firstEmpty >= 0) {
      get().placeFileAt(firstEmpty, file);
      return;
    }
    // 宫格已满:按覆盖策略选目标格(§新增,设置项 gridFullPolicy)
    const policy = useSettingsStore.getState().gridFullPolicy;
    let target = 0;
    if (policy === "selected") {
      target = s.selected ?? 0;
    } else if (policy === "first") {
      target = 0;
    } else {
      // sequential:从第一宫格开始依次向后
      target = seqCursor % s.cells.length;
      seqCursor = (seqCursor + 1) % s.cells.length;
    }
    get().placeFileAt(target, file);
  },

  placeFileAt: (index, file) => {
    void historyOpen(file.path).catch(() => {}); // 记录预览历史(失败静默,不阻塞打开)
    set((s) => {
      clearView(index);
      const cells = s.cells.slice();
      cells[index] = { id: index, file };
      return { cells, selected: index };
    });
  },

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

  refreshCell: async (index) => {
    const file = get().cells[index]?.file;
    if (!file) return;
    // 重新嗅探(文件可能被外部改成别的类型);失败保留原 kind/ext
    const d = await detectFormat(file.path).catch(() => null);
    set((s) => {
      const cur = s.cells[index]?.file;
      if (!cur) return {};
      const cells = s.cells.slice();
      cells[index] = { id: index, file: { ...cur, kind: d?.kind ?? cur.kind, ext: d?.ext ?? cur.ext } };
      return { cells };
    });
    // 自增 reloadKey → 预览组件重挂载(文本重读/媒体·图片重建);同时清掉错误态以重试
    const v = useCellViewStore.getState().views[index];
    useCellViewStore
      .getState()
      .setView(index, { reloadKey: (v?.reloadKey ?? 0) + 1, error: undefined });
  },

  select: (index) =>
    set((s) => {
      const anyFilled = s.cells.some((c) => c.file);
      if (!anyFilled) return { selected: null };
      if (index != null && s.cells[index]?.file) return { selected: index };
      return { selected: s.selected ?? firstFilledIndex(s.cells) };
    }),

  hydrate: ({ cols, rows, cells, selected }) => set({ cols, rows, cells, selected }),
}));
