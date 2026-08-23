import { useEffect, useRef } from "react";
import { FolderOpen, FolderInput, Copy } from "lucide-react";
import { useContextMenuStore, type MenuItem } from "../stores/contextMenuStore";
import { useFolderStore } from "../stores/folderStore";
import { revealInExplorer, copyPath } from "../lib/tauri";

/** 三个文件类调用点共用的标准菜单项:在资源管理器中打开 + 复制路径。 */
export function fileMenuItems(path: string): MenuItem[] {
  return [
    { label: "在资源管理器中打开", icon: FolderOpen, onClick: () => void revealInExplorer(path) },
    { label: "复制路径", icon: Copy, onClick: () => void copyPath(path) },
  ];
}

/** 文件夹右键菜单:打开该文件夹(面包屑跳转)+ 资源管理器打开 + 复制路径。 */
export function folderMenuItems(path: string): MenuItem[] {
  return [
    {
      label: "打开该文件夹",
      icon: FolderInput,
      onClick: () => void useFolderStore.getState().openFolder(path),
    },
    ...fileMenuItems(path),
  ];
}

const MENU_W = 196;
const ITEM_H = 30;

/**
 * 自绘右键菜单(§新增)。挂在 App 根部,由 contextMenuStore 驱动。
 * 关闭时机:点击菜单项 / 点击外部 / Esc / 滚动 / 窗口失焦或缩放 / 再次右键。
 */
export function ContextMenu() {
  const pos = useContextMenuStore((s) => s.pos);
  const items = useContextMenuStore((s) => s.items);
  const closeMenu = useContextMenuStore((s) => s.closeMenu);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!pos) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) closeMenu();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closeMenu();
    const onScroll = () => closeMenu();
    // mousedown 用 capture 以便在菜单外交互逻辑之前先关菜单
    window.addEventListener("mousedown", onDown, true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("contextmenu", onDown, true);
    window.addEventListener("wheel", onScroll, true);
    window.addEventListener("blur", closeMenu);
    window.addEventListener("resize", closeMenu);
    return () => {
      window.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("contextmenu", onDown, true);
      window.removeEventListener("wheel", onScroll, true);
      window.removeEventListener("blur", closeMenu);
      window.removeEventListener("resize", closeMenu);
    };
  }, [pos, closeMenu]);

  if (!pos) return null;

  // 边界钳制:避免菜单超出视口右/下边缘
  const x = Math.min(pos.x, window.innerWidth - MENU_W - 4);
  const y = Math.min(pos.y, window.innerHeight - items.length * ITEM_H - 12);

  return (
    <div
      ref={ref}
      className="fixed z-[300] min-w-[180px] rounded-md border border-line bg-panel py-1 shadow-2xl"
      style={{ left: x, top: y, width: MENU_W }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((it, i) => (
        <button
          key={i}
          className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-panel-2 ${
            it.danger ? "text-danger" : "text-text"
          }`}
          onClick={() => {
            closeMenu();
            it.onClick();
          }}
        >
          {it.icon && <it.icon size={13} className="shrink-0" />}
          <span className="truncate">{it.label}</span>
        </button>
      ))}
    </div>
  );
}
