import { FolderOpen } from "lucide-react";
import { useFolderStore } from "../stores/folderStore";
import { openFolderDialog } from "../lib/tauri";

/**
 * 面包屑(§3.1):每段可点击(点击=打开该文件夹),右侧 OpenFolder 按钮。
 * 兼容两种路径分隔符;盘符段("C:")点击时补 "\" 指向盘根。
 */
export function Breadcrumb() {
  const rootPath = useFolderStore((s) => s.rootPath);
  const openFolder = useFolderStore((s) => s.openFolder);

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
    <div className="flex items-center gap-1 border-b border-line bg-panel px-2 py-1.5">
      <div className="flex min-w-0 flex-1 items-center overflow-x-auto whitespace-nowrap text-xs">
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
      <button
        className="ml-1 flex shrink-0 items-center gap-1 rounded border border-line bg-panel-2 px-2 py-1 text-xs text-text hover:border-brand-bright"
        onClick={onOpenFolder}
        title="打开文件夹"
      >
        <FolderOpen size={13} />
        {/*打开*/}
      </button>
    </div>
  );
}
