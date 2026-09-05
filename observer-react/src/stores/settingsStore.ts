import { create } from "zustand";

/**
 * 设置(顶栏 → 设置对话框)。存资源配额、图片默认缩放、宫格占满覆盖策略。
 * 持久化(SQLite)由 lib/persistence.ts 统一处理。
 */

/** 宫格占满时打开文件的覆盖策略(§新增):selected 选中格 / first 第一格 / sequential 依次向后 */
export type GridFullPolicy = "selected" | "first" | "sequential";

/** 图片 CSS 缩放算法(image-rendering):pixelated 最近邻(像素画锐利) / auto 平滑 / crisp-edges */
export type ImageScaleMode = "auto" | "pixelated" | "crisp-edges";

interface SettingsState {
  /** 同时播放的流媒体路数上限(视频+音频),默认 5 */
  mediaQuota: number;
  /** 激活 3D 视口数上限,默认 3,硬上限 8 */
  threeDQuota: number;
  /** 图片默认缩放模式 */
  imageDefaultFit: "best-fit" | "actual";
  /** 图片 CSS 缩放算法(image-rendering),默认 pixelated(像素画/位图放大锐利) */
  imageScaleMode: ImageScaleMode;
  /** 宫格占满时的覆盖策略,默认 selected */
  gridFullPolicy: GridFullPolicy;
  /** 文本预览大小阈值(MB):超过则先提示、确认后才显示,默认 10 */
  textMaxSizeMB: number;
  /** 文本默认字号(8..32):新打开的文本文件初始字号(每文件 doc_position 字号恢复优先),默认 13 */
  textDefaultFontSize: number;
  /** 媒体默认音量(0..1):无该文件持久化记录时新文件以此音量打开,默认 0.3 */
  defaultVolume: number;
  /** 预览历史保留条数上限(超出淘汰最旧),默认 500(design.md §9.4) */
  historyRetention: number;

  setMediaQuota(n: number): void;
  setThreeDQuota(n: number): void;
  setImageDefaultFit(m: "best-fit" | "actual"): void;
  setImageScaleMode(m: ImageScaleMode): void;
  setGridFullPolicy(p: GridFullPolicy): void;
  setTextMaxSizeMB(n: number): void;
  setTextDefaultFontSize(n: number): void;
  setDefaultVolume(n: number): void;
  setHistoryRetention(n: number): void;
  /** 启动还原持久化的设置项(M2) */
  hydrate(p: {
    mediaQuota?: number;
    threeDQuota?: number;
    imageDefaultFit?: "best-fit" | "actual";
    imageScaleMode?: ImageScaleMode;
    gridFullPolicy?: GridFullPolicy;
    textMaxSizeMB?: number;
    textDefaultFontSize?: number;
    defaultVolume?: number;
    historyRetention?: number;
  }): void;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  mediaQuota: 5,
  threeDQuota: 3,
  imageDefaultFit: "best-fit",
  imageScaleMode: "pixelated",
  gridFullPolicy: "selected",
  textMaxSizeMB: 10,
  textDefaultFontSize: 13,
  defaultVolume: 0.3,
  historyRetention: 500,

  setMediaQuota: (n) => set({ mediaQuota: Math.max(1, Math.floor(n) || 1) }),
  setThreeDQuota: (n) => set({ threeDQuota: Math.min(8, Math.max(1, Math.floor(n) || 1)) }),
  setImageDefaultFit: (m) => set({ imageDefaultFit: m }),
  setImageScaleMode: (m) => set({ imageScaleMode: m }),
  setGridFullPolicy: (p) => set({ gridFullPolicy: p }),
  setTextMaxSizeMB: (n) => set({ textMaxSizeMB: Math.min(1024, Math.max(1, Math.floor(n) || 1)) }),
  setTextDefaultFontSize: (n) =>
    set({ textDefaultFontSize: Math.min(32, Math.max(8, Math.round(n) || 8)) }),
  setDefaultVolume: (n) => set({ defaultVolume: Math.min(1, Math.max(0, n || 0)) }),
  setHistoryRetention: (n) => set({ historyRetention: Math.max(1, Math.floor(n) || 1) }),
  hydrate: (p) => set(p),
}));
