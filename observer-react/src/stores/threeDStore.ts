import { create } from "zustand";

/**
 * 3D 视口配额(design.md §8.2 / layout.md §4.7):激活(实时 WebGL)视口数 ≤ threeDQuota
 * (默认 3,硬上限 8)。超出的宫格显示该模型"最后渲染帧"的静态截图,不再占 WebGL 上下文;
 * 选中/点击截图 = 激活该格,同时把"最久未交互"的已激活视口降级为截图。
 *
 * 数据态在此(zustand);各 ThreeView 注册一个 capture 引擎(渲染一帧并导出 dataURL,
 * 见下方 engines Map,非响应式),配额降级时由 useThreeDQuota 先 capture 再标记 frozen。
 */

/** 视口渲染引擎(组件注册;降级前 capture 取最后一帧) */
export interface ThreeEngine {
  capture(): string | null;
}

/** 非响应式引擎注册表(同 cellControls 的做法:动作不放 zustand) */
const engines = new Map<number, ThreeEngine>();
export function registerThreeEngine(id: number, e: ThreeEngine): () => void {
  engines.set(id, e);
  return () => {
    if (engines.get(id) === e) engines.delete(id);
  };
}
export function getThreeEngine(id: number): ThreeEngine | undefined {
  return engines.get(id);
}

export interface ThreeViewport {
  /** active = 实时 WebGL;frozen = 截图(不占上下文) */
  state: "active" | "frozen";
  /** 最近一次激活/交互时间戳(降级按"最久未交互") */
  lastInteractAt: number;
  /** 降级时的截图 dataURL(null=尚无渲染帧,显示占位) */
  snapshot: string | null;
}

interface ThreeDState {
  viewports: Record<number, ThreeViewport>;
  /** 挂载:登记为激活视口 */
  register(cellId: number): void;
  /** 卸载:移除 */
  unregister(cellId: number): void;
  /** 交互/激活:置顶 lastInteractAt;frozen → active(可能挤占他人,由配额回收) */
  touch(cellId: number): void;
  /** 配额降级:标记为 frozen 并存截图 */
  freeze(cellId: number, snapshot: string | null): void;
}

const now = () => Date.now();

export const useThreeDStore = create<ThreeDState>((set) => ({
  viewports: {},

  register: (cellId) =>
    set((s) => ({
      viewports: {
        ...s.viewports,
        [cellId]: { state: "active", lastInteractAt: now(), snapshot: null },
      },
    })),

  unregister: (cellId) =>
    set((s) => {
      const viewports = { ...s.viewports };
      delete viewports[cellId];
      return { viewports };
    }),

  touch: (cellId) =>
    set((s) => {
      const cur = s.viewports[cellId];
      if (!cur) return {};
      if (cur.state === "active") {
        // 仅更新时间戳(避免无意义重渲染)
        return { viewports: { ...s.viewports, [cellId]: { ...cur, lastInteractAt: now() } } };
      }
      return {
        viewports: {
          ...s.viewports,
          [cellId]: { state: "active", lastInteractAt: now(), snapshot: null },
        },
      };
    }),

  freeze: (cellId, snapshot) =>
    set((s) => {
      const cur = s.viewports[cellId];
      if (!cur || cur.state === "frozen") return {};
      return {
        viewports: {
          ...s.viewports,
          [cellId]: { ...cur, state: "frozen", snapshot },
        },
      };
    }),
}));
