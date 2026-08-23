import { ChevronRight, ChevronDown, Folder, File as FileIcon } from "lucide-react";
import { useFolderStore, type TreeNode } from "../stores/folderStore";
import { useGridStore } from "../stores/gridStore";
import { useContextMenuStore } from "../stores/contextMenuStore";
import { kindForExt } from "../formats/registry";
import { detectFormat } from "../lib/tauri";
import { startPointerDrag, suppressClickAfterDrag } from "../lib/pointerDrag";
import { fileMenuItems, folderMenuItems } from "./ContextMenu";
import type { DirEntry } from "../types/file";

/** 拖拽载荷:只带路径信息,kind 在落点经 detect_format 嗅探确定(处理 .ts/.m4s 等歧义后缀)。 */
interface DragPayload {
  path: string;
  name: string;
  ext: string;
}

const payloadOf = (e: DirEntry): DragPayload => ({ path: e.path, name: e.name, ext: e.ext });

/**
 * 文件树(§3.3):树形原地展开/折叠(类 VSCode explorer)。
 * 点文件夹=展开/折叠;点文件=预览进宫格。当前根自身不显示为节点。
 */
function TreeNodeRow({ node, depth }: { node: TreeNode; depth: number }) {
  const toggleDir = useFolderStore((s) => s.toggleDir);
  const placeFile = useGridStore((s) => s.placeFile);
  const { entry } = node;
  const pad = { paddingLeft: `${8 + depth * 14}px` };

  if (entry.is_dir) {
    return (
      <div>
        <button
          className="flex w-full items-center gap-1 rounded px-1 py-[3px] text-left text-xs text-text hover:bg-panel-2"
          style={pad}
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
        {node.expanded &&
          node.children?.map((child) => (
            <TreeNodeRow key={child.entry.path} node={child} depth={depth + 1} />
          ))}
      </div>
    );
  }

  const onClickFile = async () => {
    if (suppressClickAfterDrag()) return; // 拖拽松手后的残余 click 不触发
    // 经 detect_format 嗅探(区分 .ts 视频 / TypeScript、.json Lottie 等),失败回退扩展名判断
    const d = await detectFormat(entry.path).catch(() => null);
    placeFile({ path: entry.path, name: entry.name, ext: entry.ext, kind: d?.kind ?? kindForExt(entry.ext), sniffed: d?.sniffed ?? null });
  };

  return (
    <button
      className="flex w-full cursor-grab items-center gap-1 rounded px-1 py-[3px] text-left text-xs text-text-dim hover:bg-panel-2 hover:text-text active:cursor-grabbing"
      style={pad}
      onClick={onClickFile}
      onPointerDown={(e) => startPointerDrag(e, { kind: "file", ...payloadOf(entry) })}
      onContextMenu={(e) => {
        e.preventDefault();
        useContextMenuStore.getState().openMenu(e.clientX, e.clientY, fileMenuItems(entry.path));
      }}
      title={entry.path}
    >
      <span className="w-[13px] shrink-0" />
      <FileIcon size={13} className="shrink-0" />
      <span className="truncate">{entry.name}</span>
    </button>
  );
}

export function FileTree() {
  const rootChildren = useFolderStore((s) => s.rootChildren);
  const loading = useFolderStore((s) => s.loading);
  const error = useFolderStore((s) => s.error);

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
    <div className="py-1">
      {rootChildren.map((node) => (
        <TreeNodeRow key={node.entry.path} node={node} depth={0} />
      ))}
    </div>
  );
}
