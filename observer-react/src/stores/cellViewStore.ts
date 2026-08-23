import { create } from "zustand";

/**
 * 每个宫格的"响应式视图态"(供功能条 / 文件信息框渲染),
 * 以及全界面 / 全屏两个全局显示标志。
 * 命令式控制(播放/缩放…)走 cellControls,这里只存数据。
 */
export type FitMode = "best-fit" | "actual" | "free";

export interface CellView {
  playing?: boolean;
  currentTime?: number;
  duration?: number;
  volume?: number;
  rate?: number;
  fitMode?: FitMode;
  /** 图片当前缩放倍率 */
  scale?: number;
  /** 文本字号 */
  fontSize?: number;
  /** 预览失败原因(有值则该格显示错误占位) */
  error?: string;
}

interface CellViewState {
  views: Record<number, CellView>;
  /** 全界面显示的宫格 id(null=无) */
  fullViewCell: number | null;
  /** 是否操作系统级全屏 */
  fullScreen: boolean;

  setView(id: number, patch: Partial<CellView>): void;
  clearView(id: number): void;
  setFullView(cell: number | null): void;
  setFullScreen(b: boolean): void;
}

export const useCellViewStore = create<CellViewState>((set) => ({
  views: {},
  fullViewCell: null,
  fullScreen: false,

  setView: (id, patch) =>
    set((s) => ({ views: { ...s.views, [id]: { ...s.views[id], ...patch } } })),

  clearView: (id) =>
    set((s) => {
      const views = { ...s.views };
      delete views[id];
      return { views };
    }),

  setFullView: (cell) => set({ fullViewCell: cell }),
  setFullScreen: (b) => set({ fullScreen: b }),
}));
