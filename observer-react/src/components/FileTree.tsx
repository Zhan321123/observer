import { useMemo, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ChevronRight, ChevronDown, Folder, File as FileIcon } from "lucide-react";
import { useFolderStore, type TreeNode } from "../stores/folderStore";
import { useGridStore } from "../stores/gridStore";
import { useContextMenuStore } from "../stores/contextMenuStore";
import { kindForExt } from "../formats/registry";
import { detectFormat } from "../lib/tauri";
import { startPointerDrag, suppressClickAfterDrag } from "../lib/pointerDrag";
import { fileMenuItems, folderMenuItems } from "./ContextMenu";
import { TreeThumb } from "./TreeThumb";
import type { DirEntry } from "../types/file";

/** 拖拽载荷:只带路径信息,kind 在落点经 detect_format 嗅探确定(处理 .ts/.m4s 等歧义后缀)。 */
interface DragPayload {
  path: string;
  name: string;
  ext: string;
}

const payloadOf = (e: DirEntry): DragPayload => ({ path: e.path, name: e.name, ext: e.ext });

/** 行高(固定,供虚拟滚动 estimateSize;长名截断为单行) */
const ROW_H = 24;

interface FlatRow {
  node: TreeNode;
  depth: number;
}

/** 把展开的树扁平化为可见行数组(虚拟滚动的前提;expanded 的目录才下钻)。 */
function flatten(nodes: TreeNode[], depth: number, out: FlatRow[]) {
  for (const n of nodes) {
    out.push({ node: n, depth });
    if (n.entry.is_dir && n.expanded && n.children) flatten(n.children, depth + 1, out);
  }
}

function DirRow({ node, depth }: FlatRow) {
  const toggleDir = useFolderStore((s) => s.toggleDir);
  const { entry } = node;
  return (
    <button
      className="flex h-full w-full items-center gap-1 rounded px-1 text-left text-xs text-text hover:bg-panel-2"
      style={{ paddingLeft: `${8 + depth * 14}px` }}
      onClick={() => toggleDir(node)}
      onContextMenu={(e) => {
        e.preventDefault();
        useContextMenuStore.getState().openMenu(e.clientX, e.clientY, folderMenuItems(entry.path));
      }}
      title={entry.path}
    >
      {node.expanded ? (
        <ChevronDown size={13} className="shrink-0 text-text-dim" />
      ) : (
        <ChevronRight size={13} className="shrink-0 text-text-dim" />
      )}
      <Folder size={13} className="shrink-0 text-brand-bright/80" />
      <span className="truncate">{entry.name}</span>
    </button>
  );
}

function FileRow({ node, depth }: FlatRow) {
  const placeFile = useGridStore((s) => s.placeFile);
  const { entry } = node;
  const isVideo = kindForExt(entry.ext) === "video";

  const onClickFile = async () => {
    if (suppressClickAfterDrag()) return; // 拖拽松手后的残余 click 不触发
    // 经 detect_format 嗅探(区分 .ts 视频 / TypeScript、.json Lottie 等),失败回退扩展名判断
    const d = await detectFormat(entry.path).catch(() => null);
    placeFile({
      path: entry.path,
      name: entry.name,
      ext: entry.ext,
      kind: d?.kind ?? kindForExt(entry.ext),
      sniffed: d?.sniffed ?? null,
    });
  };

  return (
    <button
      className="flex h-full w-full cursor-grab items-center gap-1 rounded px-1 text-left text-xs text-text-dim hover:bg-panel-2 hover:text-text active:cursor-grabbing"
      style={{ paddingLeft: `${8 + depth * 14}px` }}
      onClick={onClickFile}
      onPointerDown={(e) => startPointerDrag(e, { kind: "file", ...payloadOf(entry) })}
      onContextMenu={(e) => {
        e.preventDefault();
        useContextMenuStore.getState().openMenu(e.clientX, e.clientY, fileMenuItems(entry.path));
      }}
      title={entry.path}
    >
      <span className="w-[13px] shrink-0" />
      {isVideo ? <TreeThumb path={entry.path} /> : <FileIcon size={13} className="shrink-0" />}
      <span className="truncate">{entry.name}</span>
    </button>
  );
}

/**
 * 文件树(§3.3):树形原地展开/折叠(类 VSCode explorer)+ 虚拟滚动(大目录不卡,§3 预留)。
 * 点文件夹=展开/折叠;点文件=预览进宫格。当前根自身不显示为节点。
 * 视频文件显示海报帧缩略图(TreeThumb,可见行懒加载)。
 */
export function FileTree() {
  const rootChildren = useFolderStore((s) => s.rootChildren);
  const loading = useFolderStore((s) => s.loading);
  const error = useFolderStore((s) => s.error);
  const scrollRef = useRef<HTMLDivElement>(null);

  // 展开的树 → 扁平可见行(toggleDir/refresh 改变 rootChildren 引用时重算)
  const flat = useMemo(() => {
    const out: FlatRow[] = [];
    flatten(rootChildren, 0, out);
    return out;
  }, [rootChildren]);

  const virtualizer = useVirtualizer({
    count: flat.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_H,
    overscan: 12,
  });

  if (loading) {
    return <div className="p-3 text-xs text-text-dim">加载中…</div>;
  }
  if (error) {
    return <div className="p-3 text-xs text-danger">打开失败:{error}</div>;
  }
  if (rootChildren.length === 0) {
    return <div className="p-3 text-xs text-text-dim">此文件夹暂无可预览内容</div>;
  }

  return (
    <div ref={scrollRef} className="h-full overflow-y-auto">
      <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
        {virtualizer.getVirtualItems().map((vi) => {
          const row = flat[vi.index];
          return (
            <div
              key={row.node.entry.path}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                height: ROW_H,
                transform: `translateY(${vi.start}px)`,
              }}
            >
              {row.node.entry.is_dir ? <DirRow {...row} /> : <FileRow {...row} />}
            </div>
          );
        })}
      </div>
    </div>
  );
}
