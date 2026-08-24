import { useEffect } from "react";
import { useCellViewStore } from "../stores/cellViewStore";
import { useGridStore } from "../stores/gridStore";
import { useSettingsStore } from "../stores/settingsStore";
import { getControl } from "../stores/cellControls";

/**
 * 流媒体并发配额(layout.md §4.7):同时播放的视频+音频路数 ≤ mediaQuota(默认 5,设置可调)。
 * 响应式实现:订阅 cellViewStore,超额时暂停"最久未起播"(lastPlayAt 最小)的一路,
 * 不动各组件的 play 调用点(覆盖宫格/全屏/键盘/自动续播等所有起播路径)。
 * 被暂停格保留进度(各组件 sync 持续写 media_position);手动恢复播放时若仍超额同样挤占。
 */
export function useMediaQuota() {
  useEffect(() => {
    const enforce = () => {
      const quota = useSettingsStore.getState().mediaQuota;
      const views = useCellViewStore.getState().views;
      const cells = useGridStore.getState().cells;
      // 当前播放中的媒体格(仅 video/audio 占配额;图片/文本/GIF/PDF 等静态格不算)
      const playing = Object.entries(views)
        .filter(([id, v]) => {
          if (!v.playing) return false;
          const kind = cells[Number(id)]?.file?.kind;
          return kind === "video" || kind === "audio";
        })
        .map(([id, v]) => ({ id: Number(id), lastPlayAt: v.lastPlayAt ?? 0 }));
      if (playing.length <= quota) return;
      // 按 lastPlayAt 升序(最旧在前),暂停超出的部分
      playing.sort((a, b) => a.lastPlayAt - b.lastPlayAt);
      for (const { id } of playing.slice(0, playing.length - quota)) {
        getControl(id)?.pause?.();
      }
    };
    return useCellViewStore.subscribe(enforce);
  }, []);
}
