import { create } from "zustand";

/**
 * 应用页面(§播放器):应用内整页切换,非路由。
 * grid = 宫格预览(默认);player = 播放器(左文件 frame 不变,右侧换成播放器)。
 * 播放引擎(PlayerEngine)挂在页面结构之外,切页不断播。
 * page 持久化(上次所在页面)由 lib/persistence.ts 统一处理;
 * mini(小窗模式)不跨重启持久化,窗口生命周期由 hooks/useMiniWindow.ts 管理。
 */
export type Page = "grid" | "player";

interface UiState {
  page: Page;
  /** 小窗模式:主窗口缩小成迷你播放器(useMiniWindow 负责缩窗/置顶/还原) */
  mini: boolean;
  /** 小窗置顶态(每次进小窗默认 true,用户可切换;不持久化) */
  miniTop: boolean;
  setPage(p: Page): void;
  setMini(b: boolean): void;
  setMiniTop(b: boolean): void;
  /** 启动还原(bootstrap,渲染前;仅 page,mini 不跨重启) */
  hydrate(p: { page?: Page }): void;
}

export const useUiStore = create<UiState>((set) => ({
  page: "grid",
  mini: false,
  miniTop: false,
  setPage: (page) => set({ page }),
  setMini: (mini) => set({ mini }),
  setMiniTop: (miniTop) => set({ miniTop }),
  hydrate: (p) => set(p),
}));
