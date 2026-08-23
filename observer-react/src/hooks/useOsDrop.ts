import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { detectFormat, allowAssetPath } from "../lib/tauri";
import { useGridStore } from "../stores/gridStore";
import { useFolderStore } from "../stores/folderStore";
import { baseName } from "../lib/format";
import type { FileRef } from "../types/file";

/** 由绝对路径构造 FileRef(经 detect_format 拿真实类型) */
export async function fileRefFromPath(path: string): Promise<FileRef> {
  const d = await detectFormat(path).catch(() => null);
  const name = baseName(path);
  const ext = (d?.ext ?? name.split(".").pop() ?? "").toLowerCase();
  return { path, name, ext, kind: d?.kind ?? "unknown" };
}

interface DragDropPayload {
  paths: string[];
  position: { x: number; y: number };
}

/**
 * OS 拖入(design.md §8 铁律:与内部 HTML5 DnD 是两条通道)。
 * dragDropEnabled=true 时,系统拖放走 tauri://drag-drop 事件(payload.paths + position),
 * 不触发 HTML5 drop。用 elementFromPoint 命中测试:
 *   - 落到某宫格 [data-cell-id] → 覆盖该格
 *   - 落到文件面板 [data-file-panel] 且是文件夹 → 打开该文件夹
 * 在 App 根部调用一次。
 */
export function useOsDrop() {
  useEffect(() => {
    const un = listen<DragDropPayload>("tauri://drag-drop", async (e) => {
      const { paths, position } = e.payload;
      if (!paths.length) return;
      const first = paths[0];
      const el = document.elementFromPoint(position.x, position.y);
      const cellEl = el?.closest("[data-cell-id]");
      const filePanel = el?.closest("[data-file-panel]");

      await allowAssetPath(first).catch(() => {});

      if (cellEl) {
        const id = Number((cellEl as HTMLElement).dataset.cellId);
        const ref = await fileRefFromPath(first);
        useGridStore.getState().placeFileAt(id, ref);
      } else if (filePanel) {
        // 拖到文件区:是文件夹则打开;是文件则预览(进首空/覆盖0号)
        const ref = await fileRefFromPath(first);
        if (ref.kind === "unknown" && !ref.ext) {
          // 很可能是文件夹(无扩展名且识别不出)→ 尝试打开
          await useFolderStore.getState().openFolder(first);
        } else {
          useGridStore.getState().placeFile(ref);
        }
      }
    });
    return () => {
      un.then((f) => f());
    };
  }, []);
}
