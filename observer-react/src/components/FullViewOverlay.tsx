import { useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useGridStore } from "../stores/gridStore";
import { useCellViewStore } from "../stores/cellViewStore";
import { resolvePreview } from "../formats/registry";
import { FunctionBar } from "./FunctionBar";

/** 底部热区高度(px):鼠标进入窗口最下方该高度内 → 浮出悬浮功能条 */
const HOT_ZONE = 48;
/** 移离底部/功能条后延时自动隐藏(ms) */
const HIDE_DELAY = 400;

/**
 * 全界面 / 全屏显示(§4.6,仅图片与视频)。
 * - 全界面:内容铺满整个应用窗口(隐藏所有 frame,仍为窗口态)。
 * - 全屏:操作系统级全屏(getCurrentWindow().setFullscreen)。
 * - Esc(或 F11)直接回到宫格视图(不逐层退);宫格布局/选中态/缩放/播放进度均保持。
 * 覆盖层独占渲染该格预览(此时对应宫格显示占位,避免双实例),交互照常(active=true)。
 *
 * 底部悬浮功能条(task.md 交互修正):鼠标移到窗口最下方热区 → 浮出功能条(对当前全屏格
 * 操作,复用 FunctionBar),移离后延时自动隐藏。热区用 window mousemove 检测、不铺
 * pointer-events 层,避免悬浮条隐藏时挡住媒体格内贴底的控制条。
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

  // 底部悬浮功能条:可见态 + 延时隐藏计时 + 条容器引用(鼠标悬停检测)
  const [barVisible, setBarVisible] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const barRef = useRef<HTMLDivElement>(null);

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

  // 热区检测:进入底部热区或悬浮条范围 → 浮出并取消隐藏;离开 → 延时隐藏
  useEffect(() => {
    if (!active) return;
    const showBar = () => {
      if (hideTimer.current) {
        clearTimeout(hideTimer.current);
        hideTimer.current = null;
      }
      setBarVisible(true);
    };
    const scheduleHide = () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
      hideTimer.current = setTimeout(() => {
        hideTimer.current = null;
        setBarVisible(false); // 已隐藏时 React 对同值不重渲染,幂等
      }, HIDE_DELAY);
    };
    const onMove = (e: MouseEvent) => {
      const inHot = e.clientY >= window.innerHeight - HOT_ZONE;
      const overBar = !!barRef.current?.contains(e.target as Node);
      if (inHot || overBar) showBar();
      else scheduleHide();
    };
    window.addEventListener("mousemove", onMove);
    return () => {
      window.removeEventListener("mousemove", onMove);
      if (hideTimer.current) {
        clearTimeout(hideTimer.current);
        hideTimer.current = null;
      }
    };
  }, [active]);

  // 覆盖层退出时收起悬浮条(下次进入不残留)
  useEffect(() => {
    if (!active) setBarVisible(false);
  }, [active]);

  if (fullViewCell == null || !file) return null;

  const resolved = resolvePreview(file);
  const Comp = resolved.component;
  const exitOverlay = () => {
    setFullScreen(false);
    setFullView(null);
  };

  return (
    <div className="fixed inset-0 z-[90] bg-black">
      <Comp
        key={file.path}
        file={file}
        cellId={fullViewCell}
        active
        reason={resolved.reason}
        strategy={resolved.strategy}
      />
      <div className="pointer-events-none absolute right-3 top-3 text-[11px] text-white/50">
        Esc 退出
      </div>
      {/* 底部悬浮功能条:热区浮出,移离延时自动隐藏(task.md 交互修正) */}
      <div
        ref={barRef}
        className={`absolute bottom-3 left-1/2 z-10 max-w-[calc(100vw-2rem)] -translate-x-1/2 transition-all duration-200 ${
          barVisible ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-3 opacity-0"
        }`}
      >
        <FunctionBar floating cellId={fullViewCell} onExit={exitOverlay} />
      </div>
    </div>
  );
}
