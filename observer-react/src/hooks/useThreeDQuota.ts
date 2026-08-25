import { useEffect } from "react";
import { useThreeDStore, getThreeEngine } from "../stores/threeDStore";
import { useSettingsStore } from "../stores/settingsStore";

/**
 * 激活 3D 视口配额(layout.md §4.7,对齐 useMediaQuota 的响应式实现):
 * 订阅 threeDStore,激活视口数超 threeDQuota 时,把"最久未交互"(lastInteractAt 最小)的
 * 已激活视口降级为截图——先经引擎 capture 取最后一帧,再标记 frozen(组件随后释放 WebGL 上下文)。
 * 调低配额立即按此回收;调高不自动恢复(需重新选中/点击截图激活)。
 */
export function useThreeDQuota() {
  useEffect(() => {
    const enforce = () => {
      const quota = useSettingsStore.getState().threeDQuota;
      const viewports = useThreeDStore.getState().viewports;
      const entries = Object.entries(viewports)
        .filter(([, v]) => v.state === "active")
        .map(([id, v]) => ({ id: Number(id), lastInteractAt: v.lastInteractAt }));
      if (entries.length <= quota) return;
      // 按 lastInteractAt 升序(最旧在前),降级超出的部分
      entries.sort((a, b) => a.lastInteractAt - b.lastInteractAt);
      for (const { id } of entries.slice(0, entries.length - quota)) {
        const snapshot = getThreeEngine(id)?.capture() ?? null;
        useThreeDStore.getState().freeze(id, snapshot);
      }
    };
    return useThreeDStore.subscribe(enforce);
  }, []);
}
