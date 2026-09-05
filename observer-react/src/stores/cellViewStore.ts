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
  /** 文本:检测出的编码名(read_text_file 返回,如 "UTF-8"/"GBK",供文件信息框) */
  textEncoding?: string;
  /** 宫格刷新信号:自增触发预览组件重挂载(重读/重建) */
  reloadKey?: number;
  /** 预览失败原因(有值则该格显示错误占位) */
  error?: string;

  /** Lottie:动画/文本模式(默认 animation) */
  lottieMode?: "animation" | "text";
  /** Lottie:兼容模式(表达式渲染失败 → 自动剥表达式重载成功后为 true,功能条显示徽标) */
  lottieCompat?: boolean;
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
  /** xlsx 双身份(task2 §5):表格/压缩包目录视角(默认 table;zip 容器可切目录树) */
  xlsxMode?: "table" | "archive";
  /** 含透明图层图片:透明棋盘格背景开关(默认关) */
  transparencyGrid?: boolean;

  /** 文档(task2 二):文档/压缩包目录双身份(默认 document;循 xlsxMode 先例) */
  docMode?: "document" | "archive";
  /** 字体(task2 二):样张/字形表视角(默认 specimen)+ 试字文本(全屏接力瞬态,默认文件名去扩展名) */
  fontMode?: "specimen" | "glyphs";
  fontText?: string;
  /** SQLite(task2 二):表清单 / 当前表下标 / 当前页偏移 / 总行数 / 结构面板开关 */
  sqliteTables?: { name: string; kind: "table" | "view"; ddl: string }[];
  sqliteTableIndex?: number;
  sqliteOffset?: number;
  sqliteTotal?: number;
  sqliteShowSchema?: boolean;

  /** CSV/TSV:表格/文本模式(默认 table) */
  csvMode?: "table" | "text";
  /** 音频:宫格主体显示模式(实时频谱柱形图 bars / 滚动波形 wave / 无 none;默认 bars,
   *  纯内存态,循 csvMode 先例由预览组件兜底默认值) */
  audioDisplay?: "bars" | "wave" | "none";
  /** SVG:预览/文本源码模式(默认 preview) */
  svgMode?: "preview" | "text";
  /** PDF:当前页(0 基)/ 总页数 / 缩放倍率(供功能条翻页与缩放) */
  pdfPage?: number;
  pdfPageCount?: number;
  pdfScale?: number;
  /** PDF:平移瞬态(x/y,全屏切换接力;重启才走 doc_position) */
  pdfX?: number;
  pdfY?: number;

  /** 3D:相机瞬态接力(全屏切换保留视角,同步读取无 IPC 竞态;重启才走 threed_camera)。
   *  path 标记该视角属于哪个文件:宫内替换文件时旧相机的瞬态不被新模型误用(§修改点1)。 */
  threedCam?: { path: string; p: [number, number, number]; t: [number, number, number] };
  /** 3D:平面网格显示开关(默认 true) */
  threedGrid?: boolean;
  /** 3D:线框模式开关(默认 false) */
  threedWireframe?: boolean;
  /** 3D:自动旋转开关(默认 false) */
  threedAutoRotate?: boolean;
  /** 3D:光照环境预设下标(默认 0) */
  threedLight?: number;
  /** 3D:模型统计(顶点/面/材质/动画/包围盒,供文件信息框) */
  threedInfo?: {
    vertices: number;
    triangles: number;
    materials: number;
    animations: number;
    bbox: [number, number, number];
  };
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
