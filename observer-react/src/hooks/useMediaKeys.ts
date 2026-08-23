import { useEffect } from "react";
import { useGridStore } from "../stores/gridStore";
import { getControl } from "../stores/cellControls";

/**
 * 全局媒体快捷键(§第三批):
 * - 空格:视频/音频播放/暂停;gif 播放/暂停。
 * - ← / →:视频、gif 上一帧 / 下一帧。
 * 焦点在输入控件(input/select/textarea/contentEditable)时不劫持;
 * 控制按事件时取(getControl),避免渲染期快照拿到过期闭包。全界面下同 cellId 重注册,天然生效。
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
