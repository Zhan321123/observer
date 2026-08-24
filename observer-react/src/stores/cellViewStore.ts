import { create } from "zustand";

/**
 * 每个宫格的"响应式视图态"(供功能条 / 文件信息框渲染),
 * 以及全界面 / 全屏两个全局显示标志。
 * 命令式控制(播放/缩放…)走 cellControls,这里只存数据。
 */
export type FitMode = "best-fit" | "actual" | "free";

export interface CellView {
  playing?: boolean;
  /** 最近一次"开始播放"的时间戳(媒体并发配额:超额时暂停该值最小=最久未起播的一路,§4.7) */
  lastPlayAt?: number;
  currentTime?: number;
  duration?: number;
  volume?: number;
  rate?: number;
  fitMode?: FitMode;
  /** 图片当前缩放倍率 */
  scale?: number;
  /** 图片平移/缩放瞬态(x/y/s):全屏切换时经 store 同步接力(卸载/重挂载无 IPC 竞态),重启才走 doc_position */
  imgX?: number;
  imgY?: number;
  imgS?: number;
  /** 文本字号 */
  fontSize?: number;
  /** 文本:行号开关(默认关) */
  lineNumbers?: boolean;
  /** 文本:自动换行开关(默认关) */
  wordWrap?: boolean;
  /** 宫格刷新信号:自增触发预览组件重挂载(重读/重建) */
  reloadKey?: number;
  /** 预览失败原因(有值则该格显示错误占位) */
  error?: string;

  /** Lottie:动画/文本模式(默认 animation) */
  lottieMode?: "animation" | "text";
  /** Markdown:预览/文本模式(默认 preview) */
  mdMode?: "preview" | "text";
  /** GIF:是否播放中 / 当前帧 / 总帧数(供功能条帧控件) */
  gifPlaying?: boolean;
  gifFrame?: number;
  gifFrameCount?: number;
  /** ICO:可选尺寸标签(如 "256×256")/ 当前尺寸下标 */
  icoSizes?: string[];
  icoIndex?: number;
  /** xlsx:工作表名列表 / 当前 sheet 下标(默认 0) */
  sheetNames?: string[];
  sheetIndex?: number;
  /** 含透明图层图片:透明棋盘格背景开关(默认关) */
  transparencyGrid?: boolean;

  /** CSV/TSV:表格/文本模式(默认 table) */
  csvMode?: "table" | "text";
  /** SVG:预览/文本源码模式(默认 preview) */
  svgMode?: "preview" | "text";
  /** PDF:当前页(0 基)/ 总页数 / 缩放倍率(供功能条翻页与缩放) */
  pdfPage?: number;
  pdfPageCount?: number;
  pdfScale?: number;
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
