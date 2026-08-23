import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useGridStore } from "../stores/gridStore";
import { useCellViewStore } from "../stores/cellViewStore";
import { resolvePreview } from "../formats/registry";

/**
 * 全界面 / 全屏显示(§4.6,仅图片与视频)。
 * - 全界面:内容铺满整个应用窗口(隐藏所有 frame,仍为窗口态)。
 * - 全屏:操作系统级全屏(getCurrentWindow().setFullscreen)。
 * - Esc(或 F11)直接回到宫格视图(不逐层退);宫格布局/选中态/缩放/播放进度均保持。
 * 覆盖层独占渲染该格预览(此时对应宫格显示占位,避免双实例),交互照常(active=true)。
 */
export function FullViewOverlay() {
  const fullViewCell = useCellViewStore((s) => s.fullViewCell);
  const fullScreen = useCellViewStore((s) => s.fullScreen);
  const setFullView = useCellViewStore((s) => s.setFullView);
  const setFullScreen = useCellViewStore((s) => s.setFullScreen);
  const file = useGridStore((s) => (fullViewCell != null ? s.cells[fullViewCell]?.file : null));

  const active = fullViewCell != null;
  // 只有"全屏显示"(非全界面)才应用 OS 级全屏
  const osFullScreen = active && fullScreen;

  // 应用 OS 全屏;effect cleanup 保证退出时一定撤销
  // (本组件常驻挂载、inactive 时返回 null,不能靠 unmount 触发清理,故用依赖翻转驱动 cleanup)
  useEffect(() => {
    if (!osFullScreen) return;
    const win = getCurrentWindow();
    void win.setFullscreen(true).catch(() => {});
    return () => {
      void win.setFullscreen(false).catch(() => {});
    };
  }, [osFullScreen]);

  // Esc / F11 退出(回到宫格视图)
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "F11") {
        e.preventDefault();
        setFullScreen(false);
        setFullView(null);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [active, setFullView, setFullScreen]);

  if (fullViewCell == null || !file) return null;

  const resolved = resolvePreview(file);
  const Comp = resolved.component;

  return (
    <div className="fixed inset-0 z-[90] bg-black">
      <Comp file={file} cellId={fullViewCell} active reason={resolved.reason} strategy={resolved.strategy} />
      <div className="pointer-events-none absolute right-3 top-3 text-[11px] text-white/50">
        Esc 退出
      </div>
    </div>
  );
}
