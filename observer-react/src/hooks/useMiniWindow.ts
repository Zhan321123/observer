import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { LogicalSize } from "@tauri-apps/api/dpi";
import { useUiStore } from "../stores/uiStore";
import { stateGet } from "../lib/persist";
import { clamp } from "../lib/format";

/**
 * 小窗模式(§播放器迭代二)的窗口生命周期,App 挂载一次:
 * - 进入:记录当前逻辑尺寸(退出还原用)→ 放宽 minWidth 960 限制 → 缩到持久化的小窗尺寸
 *   (无记录用默认 380×280)→ 置顶(默认开)。
 * - 退出:取消置顶 → 还原最小尺寸 960×600 → 还原进入前的窗口尺寸。
 * - 尺寸持久化:resize 由 persistence.ts 的 onResized 订阅按 mini 态分流写
 *   KEY_WINDOW_MINI / KEY_WINDOW(先改 store 再动窗口 → 程序化 setSize 触发的
 *   resize 事件写对各自的键,幂等)。
 * 所有窗口调用容错(失败不阻塞模式切换);mini 本身不跨重启。
 */

/** 小窗尺寸范围与默认值(逻辑像素) */
const MINI_MIN = { w: 240, h: 180 };
const MINI_MAX = { w: 2000, h: 1200 };
const MINI_DEFAULT = new LogicalSize(380, 280);
/** tauri.conf 的窗口最小尺寸(退出小窗时还原) */
const FULL_MIN = new LogicalSize(960, 600);

export function useMiniWindow() {
  useEffect(() => {
    let prevSize: LogicalSize | null = null; // 进入前的完整窗口尺寸(退出还原)
    return useUiStore.subscribe((s, prev) => {
      if (s.mini === prev.mini) return;
      const win = getCurrentWindow();
      if (s.mini) {
        void (async () => {
          // 记录当前尺寸(scaleFactor → 逻辑尺寸,与 persistence 的持久化口径一致)
          const scale = await win.scaleFactor().catch(() => 1);
          const phys = await win.innerSize().catch(() => null);
          if (phys) prevSize = new LogicalSize(phys.width / scale, phys.height / scale);
          // 放宽最小尺寸(960×600)→ 缩到持久化的小窗尺寸(无记录用默认)
          await win.setMinSize(new LogicalSize(MINI_MIN.w, MINI_MIN.h)).catch(() => {});
          let size = MINI_DEFAULT;
          try {
            const raw = await stateGet("windowMini");
            if (raw) {
              const p = JSON.parse(raw) as { width?: number; height?: number };
              // ≥ 完整窗口最小尺寸(960×600)视为无效:权限修复前 setMinSize 被拒,
              // 拖拽被系统回弹到 960×600 时误写的记录 → 回退默认小窗尺寸
              if (
                p.width &&
                p.height &&
                !(p.width >= FULL_MIN.width && p.height >= FULL_MIN.height)
              ) {
                size = new LogicalSize(
                  clamp(p.width, MINI_MIN.w, MINI_MAX.w),
                  clamp(p.height, MINI_MIN.h, MINI_MAX.h)
                );
              }
            }
          } catch {
            // 无持久化 → 默认尺寸
          }
          await win.setSize(size).catch(() => {});
          // 默认置顶
          await win.setAlwaysOnTop(true).catch(() => {});
          useUiStore.getState().setMiniTop(true);
        })();
      } else {
        void (async () => {
          await win.setAlwaysOnTop(false).catch(() => {});
          await win.setMinSize(FULL_MIN).catch(() => {});
          if (prevSize) await win.setSize(prevSize).catch(() => {});
        })();
      }
    });
  }, []);
}
