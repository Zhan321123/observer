import { FolderOpen, RotateCw, ChevronsUpDown, ChevronsDownUp } from "lucide-react";
import { useFolderStore } from "../stores/folderStore";
import { openFolderDialog } from "../lib/tauri";

/**
 * 文件 frame 顶栏(§3.1),两行:
 *   行1 面包屑 —— 每段可点击(点击=打开该文件夹),横向滚动;
 *   行2 操作条 —— 刷新 / 打开文件夹 │ 展开一层 / 全部闭合。
 * 兼容两种路径分隔符;盘符段("C:")点击时补 "\" 指向盘根。
 * "展开一层"只展开当前可见的折叠目录各一级(懒加载树不递归全展开——根目录下会变扫盘);
 * "全部闭合"同步折叠全部,已加载子级保留(重展秒开)。
 */
export function Breadcrumb() {
  const rootPath = useFolderStore((s) => s.rootPath);
  const openFolder = useFolderStore((s) => s.openFolder);
  const refresh = useFolderStore((s) => s.refresh);
  const expandOneLevel = useFolderStore((s) => s.expandOneLevel);
  const collapseAll = useFolderStore((s) => s.collapseAll);
  const loading = useFolderStore((s) => s.loading);

  const segments = rootPath.split(/[\\/]+/).filter(Boolean);
  const sep = rootPath.includes("\\") ? "\\" : "/";

  const pathAt = (i: number) => {
    const seg = segments[i];
    if (i === 0 && /^[A-Za-z]:$/.test(seg)) return seg + "\\"; // 盘符根
    return segments.slice(0, i + 1).join(sep);
  };

  const onOpenFolder = async () => {
    const res = await openFolderDialog();
    if (typeof res === "string") await openFolder(res);
  };

  return (
    <div className="border-b border-line bg-panel">
      {/* 行1:面包屑(独占一行,长路径横向滚动) */}
      <div className="flex items-center gap-1 overflow-x-auto whitespace-nowrap px-2 py-1.5 text-xs">
        {segments.map((seg, i) => (
          <span key={i} className="flex items-center">
            {i > 0 && <span className="mx-0.5 text-text-dim/60">/</span>}
            <button
              className="rounded px-1 py-0.5 text-text-dim hover:bg-panel-2 hover:text-text"
              onClick={() => openFolder(pathAt(i))}
              title={pathAt(i)}
            >
              {seg}
            </button>
          </span>
        ))}
        {segments.length === 0 && <span className="text-text-dim">未打开文件夹</span>}
      </div>
      {/* 行2:操作条 */}
      <div className="flex items-center gap-1 border-t border-line px-2 py-1">
        <button
          className="flex shrink-0 items-center gap-1 rounded border border-line bg-panel-2 px-2 py-1 text-xs text-text hover:border-brand-bright disabled:opacity-50"
          onClick={() => void refresh()}
          disabled={loading || !rootPath}
          title="刷新文件区"
        >
          <RotateCw size={13} className={loading ? "animate-spin" : ""} />
        </button>
        <button
          className="flex shrink-0 items-center gap-1 rounded border border-line bg-panel-2 px-2 py-1 text-xs text-text hover:border-brand-bright"
          onClick={onOpenFolder}
          title="打开文件夹"
        >
          <FolderOpen size={13} />
        </button>
        <div className="mx-1 h-5 w-px bg-line" />
        <button
          className="flex h-7 w-7 items-center justify-center rounded text-text-dim hover:bg-panel-2 hover:text-text disabled:opacity-30"
          onClick={() => void expandOneLevel()}
          disabled={!rootPath}
          title="展开一层(只展开当前可见的折叠目录,可连点逐层下探)"
        >
          <ChevronsUpDown size={14} />
        </button>
        <button
          className="flex h-7 w-7 items-center justify-center rounded text-text-dim hover:bg-panel-2 hover:text-text disabled:opacity-30"
          onClick={collapseAll}
          disabled={!rootPath}
          title="全部闭合"
        >
          <ChevronsDownUp size={14} />
        </button>
      </div>
    </div>
  );
}
