import { create } from "zustand";
import { desktopDir } from "@tauri-apps/api/path";
import { listDir, allowAssetPath } from "../lib/tauri";
import { isPreviewableExt } from "../formats/registry";
import { isSplitTail, isSplitFirstVolume } from "../lib/archiveVol";
import type { DirEntry } from "../types/file";

export interface TreeNode {
  entry: DirEntry;
  /** null = 尚未加载;[] = 已加载但为空 */
  children: TreeNode[] | null;
  expanded: boolean;
}

const toNode = (e: DirEntry): TreeNode => ({ entry: e, children: null, expanded: false });

/** 内容列表规则(§3.3):保留所有文件夹;文件只显示可预览的。
 *  分卷压缩(task2 §6):尾卷(.part2.rar 等)当不可预览隐藏,避免误开半个包;
 *  首卷(.part1.rar/.7z.001)放行,预览时给"暂不支持"占位。 */
const visible = (list: DirEntry[]) =>
  list.filter(
    (e) =>
      e.is_dir ||
      (!isSplitTail(e.name) && (isPreviewableExt(e.ext) || isSplitFirstVolume(e.name)))
  );

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
  /** 刷新文件区:重列根及所有已展开目录(保留展开态) */
  refresh(): Promise<void>;
  /** 收集当前展开的目录路径(树展开持久化的序列化源) */
  getExpandedPaths(): string[];
  /** 按路径集合重展开(树展开持久化还原用;须在 openFolder 之后调用) */
  applyExpandedPaths(paths: string[]): Promise<void>;
  /** 展开一层:当前可见范围内的折叠目录各展开一级(不递归新载入的子级 → 连点逐层下探,防全展开变扫盘) */
  expandOneLevel(): Promise<void>;
  /** 全部闭合:同步折叠所有已展开目录(已加载子级保留,重展秒开) */
  collapseAll(): void;
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

  refresh: async () => {
    const { rootPath } = get();
    if (!rootPath) return;
    // 收集当前展开的目录路径(用于刷新后恢复展开态)
    const expanded = new Set<string>();
    const collect = (nodes: TreeNode[]) => {
      for (const n of nodes) {
        if (n.expanded) {
          expanded.add(n.entry.path);
          if (n.children) collect(n.children);
        }
      }
    };
    collect(get().rootChildren);

    set({ loading: true, error: null });
    // 递归重建:重列每个目录,展开过的目录继续向下重列
    const build = async (path: string): Promise<TreeNode[]> => {
      let list: DirEntry[] = [];
      try {
        list = await listDir(path);
      } catch {
        list = [];
      }
      const nodes = visible(list).map(toNode);
      for (const n of nodes) {
        if (n.entry.is_dir && expanded.has(n.entry.path)) {
          n.expanded = true;
          n.children = await build(n.entry.path);
        }
      }
      return nodes;
    };
    try {
      await allowAssetPath(rootPath).catch(() => {});
      const rootChildren = await build(rootPath);
      set({ rootChildren, loading: false });
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },

  getExpandedPaths: () => {
    const out: string[] = [];
    const walk = (nodes: TreeNode[]) => {
      for (const n of nodes) {
        if (n.expanded) {
          out.push(n.entry.path);
          if (n.children) walk(n.children);
        }
      }
    };
    walk(get().rootChildren);
    return out;
  },

  applyExpandedPaths: async (paths) => {
    const want = new Set(paths);
    if (want.size === 0) return;
    // 递归:目标集合内的目录展开并预取子级(复用 toggleDir 的懒加载逻辑)
    const walk = async (nodes: TreeNode[]): Promise<void> => {
      for (const n of nodes) {
        if (!n.entry.is_dir || !want.has(n.entry.path)) continue;
        n.expanded = true;
        if (n.children == null) {
          try {
            n.children = visible(await listDir(n.entry.path)).map(toNode);
          } catch {
            n.children = [];
          }
        }
        if (n.children) await walk(n.children);
      }
    };
    await walk(get().rootChildren);
    set({ rootChildren: [...get().rootChildren] }); // 触发渲染
  },

  expandOneLevel: async () => {
    // 只收集"当前可见"的折叠目录(展开过的分支才下钻收集),各展开一级;
    // 新载入的子级保持折叠 → 每点一次下探一层,不会一次递归整棵子树
    const collapsed: TreeNode[] = [];
    const collect = (nodes: TreeNode[]) => {
      for (const n of nodes) {
        if (!n.entry.is_dir) continue;
        if (!n.expanded) collapsed.push(n);
        else if (n.children) collect(n.children);
      }
    };
    collect(get().rootChildren);
    await Promise.all(
      collapsed.map(async (n) => {
        if (n.children == null) {
          try {
            n.children = visible(await listDir(n.entry.path)).map(toNode);
          } catch {
            n.children = [];
          }
        }
        n.expanded = true;
      }),
    );
    set({ rootChildren: [...get().rootChildren] }); // 触发渲染
  },

  collapseAll: () => {
    const walk = (nodes: TreeNode[]) => {
      for (const n of nodes) {
        if (n.expanded) {
          n.expanded = false;
          if (n.children) walk(n.children);
        }
      }
    };
    walk(get().rootChildren);
    set({ rootChildren: [...get().rootChildren] });
  },
}));
