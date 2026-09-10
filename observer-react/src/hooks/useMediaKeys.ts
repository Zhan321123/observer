import { useEffect } from "react";
import { useGridStore } from "../stores/gridStore";
import { getControl } from "../stores/cellControls";
import { useUiStore } from "../stores/uiStore";
import { usePlayerStore } from "../stores/playerStore";

/**
 * 全局媒体快捷键(§第三批):
 * - 播放器页:空格 = 播放/暂停;← / → = 快退/快进 5s。
 * - 宫格页:空格 = 视频/音频播放暂停、gif 播放暂停;← / → = 视频、gif 上一帧/下一帧。
 * 焦点在输入控件(input/select/textarea/contentEditable)时不劫持;
 * 控制按事件时取(getControl / getState),避免渲染期快照拿到过期闭包。全界面下同 cellId 重注册,天然生效。
 */
export function useMediaKeys() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "SELECT" ||
          t.tagName === "TEXTAREA" ||
          t.isContentEditable)
      )
        return;

      // 播放器页:快捷键归播放器(事件时取状态,宫格页行为不受影响)
      if (useUiStore.getState().page === "player") {
        const st = usePlayerStore.getState();
        if (e.key === " ") {
          e.preventDefault();
          st.toggle();
        } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
          if (st.index >= 0) {
            e.preventDefault();
            st.seek(st.currentTime + (e.key === "ArrowLeft" ? -5 : 5));
          }
        }
        return;
      }

      const { selected, cells } = useGridStore.getState();
      if (selected == null) return;
      const file = cells[selected]?.file;
      if (!file) return;
      const ctl = getControl(selected);
      if (!ctl) return;
      const isGif = file.ext === "gif";

      if (e.key === " ") {
        if (file.kind === "video" || file.kind === "audio") {
          e.preventDefault();
          ctl.toggle?.();
        } else if (isGif) {
          e.preventDefault();
          ctl.gifTogglePlay?.();
        }
      } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        const dir: 1 | -1 = e.key === "ArrowLeft" ? -1 : 1;
        if (file.kind === "video") {
          e.preventDefault();
          ctl.stepFrame?.(dir);
        } else if (isGif) {
          e.preventDefault();
          ctl.gifStep?.(dir);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
