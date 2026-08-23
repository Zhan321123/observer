import { create } from "zustand";
import { desktopDir } from "@tauri-apps/api/path";
import { listDir, allowAssetPath } from "../lib/tauri";
import { isPreviewableExt } from "../formats/registry";
import type { DirEntry } from "../types/file";

export interface TreeNode {
  entry: DirEntry;
  /** null = 尚未加载;[] = 已加载但为空 */
  children: TreeNode[] | null;
  expanded: boolean;
}

const toNode = (e: DirEntry): TreeNode => ({ entry: e, children: null, expanded: false });

/** 内容列表规则(§3.3):保留所有文件夹;文件只显示可预览的 */
const visible = (list: DirEntry[]) => list.filter((e) => e.is_dir || isPreviewableExt(e.ext));

interface FolderState {
  rootPath: string;
  rootChildren: TreeNode[];
  loading: boolean;
  error: string | null;

  /** 启动:默认打开桌面 */
  init(): Promise<void>;
  openFolder(path: string): Promise<void>;
  /** 展开/折叠文件夹(原地树形,懒加载子内容) */
  toggleDir(node: TreeNode): Promise<void>;
}

export const useFolderStore = create<FolderState>((set, get) => ({
  rootPath: "",
  rootChildren: [],
  loading: false,
  error: null,

  init: async () => {
    try {
      const d = await desktopDir();
      await get().openFolder(d);
    } catch {
      // desktopDir 失败时留空,用户可手动 OpenFolder
    }
  },

  openFolder: async (path) => {
    set({ loading: true, error: null, rootPath: path, rootChildren: [] });
    try {
      await allowAssetPath(path); // 运行时 asset scope 授权
      const list = await listDir(path);
      set({ rootChildren: visible(list).map(toNode), loading: false });
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },

  toggleDir: async (node) => {
    if (node.children == null) {
      try {
        const list = await listDir(node.entry.path);
        node.children = visible(list).map(toNode);
      } catch {
        node.children = [];
      }
    }
    node.expanded = !node.expanded;
    set({ rootChildren: [...get().rootChildren] }); // 触发渲染
  },
}));
