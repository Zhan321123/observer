import { useEffect } from "react";
import { X, Shapes } from "lucide-react";
import { supportedTypes } from "../formats/registry";

interface Props {
  open: boolean;
  onClose: () => void;
}

const LABELS: Record<string, string> = {
  image: "图片",
  video: "视频",
  audio: "音频",
  markdown: "Markdown",
  spreadsheet: "表格",
  pdf: "PDF",
  text: "文本 / 代码",
};

/**
 * 适配类型(顶栏「适配类型」):按类别分组列出全部可预览的扩展名。
 * 数据来自格式注册表 supportedTypes()(与路由同序,单一事实来源)。
 */
export function SupportedTypesDialog({ open, onClose }: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const groups = supportedTypes();

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="flex max-h-[70vh] w-[560px] flex-col rounded-lg border border-line bg-panel shadow-2xl">
        <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
          <h2 className="flex items-center gap-2 text-sm font-medium">
            <Shapes size={15} className="text-text-dim" />
            适配类型
          </h2>
          <button className="text-text-dim hover:text-text" onClick={onClose} title="关闭">
            <X size={16} />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-3">
          {groups.map((g) => (
            <section key={g.name}>
              <h3 className="mb-1.5 text-xs font-medium text-text-dim">
                {LABELS[g.name] ?? g.name}
                <span className="ml-2 text-text-dim/50">{g.exts.length} 种</span>
              </h3>
              <div className="flex flex-wrap gap-1">
                {g.exts.map((e) => (
                  <span
                    key={e}
                    className="rounded border border-line/60 bg-panel-2 px-1.5 py-0.5 font-mono text-[11px] text-text"
                  >
                    .{e}
                  </span>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
