import { create } from "zustand";

/**
 * 设置(顶栏 → 设置对话框)。本轮只存资源配额与图片默认缩放模式。
 * 持久化(SQLite)留待 M2。
 */
interface SettingsState {
  /** 同时播放的流媒体路数上限(视频+音频),默认 5 */
  mediaQuota: number;
  /** 激活 3D 视口数上限,默认 3,硬上限 8 */
  threeDQuota: number;
  /** 图片默认缩放模式 */
  imageDefaultFit: "best-fit" | "actual";

  setMediaQuota(n: number): void;
  setThreeDQuota(n: number): void;
  setImageDefaultFit(m: "best-fit" | "actual"): void;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  mediaQuota: 5,
  threeDQuota: 3,
  imageDefaultFit: "best-fit",

  setMediaQuota: (n) => set({ mediaQuota: Math.max(1, Math.floor(n) || 1) }),
  setThreeDQuota: (n) => set({ threeDQuota: Math.min(8, Math.max(1, Math.floor(n) || 1)) }),
  setImageDefaultFit: (m) => set({ imageDefaultFit: m }),
}));
