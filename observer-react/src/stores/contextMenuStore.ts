import { create } from "zustand";
import type { LucideIcon } from "lucide-react";

/**
 * 自绘右键菜单状态(全局单例)。
 * 背景:dragDropEnabled=true 禁用页面内 HTML5 DnD,但不影响右键(contextmenu)。
 * 三处调用点(文件树文件项 / 打开的文件列表项 / 宫格标题栏文件名)通过 openMenu 弹菜单,
 * 由 App 根部的 <ContextMenu/> 统一渲染。
 */
export interface MenuItem {
  label: string;
  icon?: LucideIcon;
  /** 危险项(红色),如"清空历史记录" */
  danger?: boolean;
  onClick(): void;
}

interface ContextMenuState {
  /** 打开时的屏幕坐标(null = 关闭) */
  pos: { x: number; y: number } | null;
  items: MenuItem[];
  openMenu(x: number, y: number, items: MenuItem[]): void;
  closeMenu(): void;
}

export const useContextMenuStore = create<ContextMenuState>((set) => ({
  pos: null,
  items: [],
  openMenu: (x, y, items) => set({ pos: { x, y }, items }),
  closeMenu: () => set({ pos: null, items: [] }),
}));
