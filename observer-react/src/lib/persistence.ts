// 宫格全景 + 当前文件夹的持久化编排(design.md §9 / task.md「持久化宫格全景」)。
// - 启动 bootstrap():从 SQLite app_state 读出布局/选中/各格文件/当前文件夹并整体还原。
// - startPersistence():订阅 store 变化,防抖 500ms 写回 app_state。
// 视图位置(播放进度/滚动/缩放)按 path 存于 media_position / doc_position,由各预览组件自理,不在此。

import { useGridStore, type CellState } from "../stores/gridStore";
import { useFolderStore } from "../stores/folderStore";
import { useSettingsStore } from "../stores/settingsStore";
import { stateGet, stateSet } from "./persist";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { LogicalSize } from "@tauri-apps/api/dpi";
import type { FileRef } from "../types/file";

const KEY_GRID = "grid";
const KEY_FOLDER = "folder";
const KEY_SETTINGS = "settings";
const KEY_WINDOW = "window";
const KEY_TREE = "treeExpanded";

interface PersistedGrid {
  cols: number;
  rows: number;
  selected: number | null;
  cells: { id: number; file: FileRef | null }[];
}

const serializeGrid = (): string => {
  const s = useGridStore.getState();
  return JSON.stringify({
    cols: s.cols,
    rows: s.rows,
    selected: s.selected,
    cells: s.cells.map((c) => ({ id: c.id, file: c.file })),
  } satisfies PersistedGrid);
};

const clamp19 = (n: number) => Math.min(9, Math.max(1, Math.floor(n) || 1));

/** 启动还原:宫格全景 + 当前文件夹 + 设置项。渲染门控前调用一次。 */
export async function bootstrap(): Promise<void> {
  // 0. 设置项(资源配额 / 图片偏好 / 宫格覆盖策略)
  try {
    const raw = await stateGet(KEY_SETTINGS);
    if (raw) useSettingsStore.getState().hydrate(JSON.parse(raw));
  } catch {
    // 还原失败用默认值
  }

  // 0.5 窗口尺寸(task.md:重启恢复;校验 ≥ tauri.conf 的 minWidth/minHeight 960×600)
  try {
    const raw = await stateGet(KEY_WINDOW);
    if (raw) {
      const { width, height } = JSON.parse(raw) as { width: number; height: number };
      if (width >= 960 && height >= 600) {
        await getCurrentWindow()
          .setSize(new LogicalSize(width, height))
          .catch(() => {});
      }
    }
  } catch {
    // 尺寸还原失败用 tauri.conf 默认
  }

  // 1. 宫格全景(布局 + 各格文件 + 选中格)
  try {
    const raw = await stateGet(KEY_GRID);
    if (raw) {
      const p = JSON.parse(raw) as PersistedGrid;
      const cols = clamp19(p.cols);
      const rows = clamp19(p.rows);
      const cells: CellState[] = Array.from({ length: cols * rows }, (_, i) => ({
        id: i,
        file: p.cells?.[i]?.file ?? null,
      }));
      // 选中格需落在有文件的格上,否则取第一个有文件的格
      let selected = p.selected;
      if (selected == null || !cells[selected]?.file) {
        selected = cells.find((c) => c.file)?.id ?? null;
      }
      useGridStore.getState().hydrate({ cols, rows, cells, selected });
    }
  } catch {
    // 还原失败 → 保留默认 1×1,不影响启动
  }

  // 2. 当前文件夹 + 树展开状态(文件夹失效如已被删除则回退默认桌面)
  try {
    const folder = await stateGet(KEY_FOLDER);
    if (folder) {
      await useFolderStore.getState().openFolder(folder);
      if (!useFolderStore.getState().error) {
        // 文件夹打开成功 → 还原其上次的树展开状态
        try {
          const raw = await stateGet(KEY_TREE);
          if (raw) await useFolderStore.getState().applyExpandedPaths(JSON.parse(raw));
        } catch {
          // 展开还原失败不影响启动
        }
        return; // 成功
      }
      // 持久化的文件夹已不可读 → 回退默认
    }
  } catch {
    // 落入默认
  }
  await useFolderStore.getState().init();
}

let started = false;

/** 订阅 store 变化并防抖写回。bootstrap 完成后调用一次。 */
export function startPersistence(): void {
  if (started) return;
  started = true;

  let gridTimer: ReturnType<typeof setTimeout> | null = null;
  useGridStore.subscribe(() => {
    if (gridTimer) clearTimeout(gridTimer);
    gridTimer = setTimeout(() => {
      void stateSet(KEY_GRID, serializeGrid()).catch(() => {});
    }, 500);
  });

  let folderTimer: ReturnType<typeof setTimeout> | null = null;
  useFolderStore.subscribe((s, prev) => {
    if (s.rootPath === prev.rootPath) return;
    if (folderTimer) clearTimeout(folderTimer);
    folderTimer = setTimeout(() => {
      void stateSet(KEY_FOLDER, useFolderStore.getState().rootPath).catch(() => {});
    }, 500);
  });

  let settingsTimer: ReturnType<typeof setTimeout> | null = null;
  useSettingsStore.subscribe(() => {
    if (settingsTimer) clearTimeout(settingsTimer);
    settingsTimer = setTimeout(() => {
      const s = useSettingsStore.getState();
      void stateSet(
        KEY_SETTINGS,
        JSON.stringify({
          mediaQuota: s.mediaQuota,
          threeDQuota: s.threeDQuota,
          imageDefaultFit: s.imageDefaultFit,
          gridFullPolicy: s.gridFullPolicy,
          textMaxSizeMB: s.textMaxSizeMB,
          defaultVolume: s.defaultVolume,
          historyRetention: s.historyRetention,
        })
      ).catch(() => {});
    }, 500);
  });

  // 树展开状态(rootChildren 引用变化 → 防抖写回展开路径集合)
  let treeTimer: ReturnType<typeof setTimeout> | null = null;
  useFolderStore.subscribe((s, prev) => {
    if (s.rootChildren === prev.rootChildren) return;
    if (treeTimer) clearTimeout(treeTimer);
    treeTimer = setTimeout(() => {
      void stateSet(KEY_TREE, JSON.stringify(useFolderStore.getState().getExpandedPaths())).catch(
        () => {}
      );
    }, 500);
  });

  // 窗口尺寸(resize → 防抖写回逻辑尺寸,与 bootstrap 的 LogicalSize 还原对应)
  let winTimer: ReturnType<typeof setTimeout> | null = null;
  void getCurrentWindow().onResized(() => {
    if (winTimer) clearTimeout(winTimer);
    winTimer = setTimeout(() => {
      void (async () => {
        const win = getCurrentWindow();
        const scale = await win.scaleFactor().catch(() => 1);
        const phys = await win.innerSize().catch(() => null);
        if (!phys) return;
        void stateSet(
          KEY_WINDOW,
          JSON.stringify({
            width: Math.round(phys.width / scale),
            height: Math.round(phys.height / scale),
          })
        ).catch(() => {});
      })();
    }, 500);
  });
}
