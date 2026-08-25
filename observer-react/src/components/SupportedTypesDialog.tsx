import { useEffect, useState } from "react";
import { X, Shapes, Search } from "lucide-react";
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

/** 子串高亮:把 text 中所有(大小写不敏感)匹配 q 的片段包成 <mark> */
function Hi({ text, q }: { text: string; q: string }) {
  if (!q) return <>{text}</>;
  const lower = text.toLowerCase();
  const parts: React.ReactNode[] = [];
  let i = 0;
  let k = 0;
  for (;;) {
    const idx = lower.indexOf(q, i);
    if (idx < 0) {
      parts.push(text.slice(i));
      break;
    }
    if (idx > i) parts.push(text.slice(i, idx));
    parts.push(
      <mark key={k++} className="rounded-[2px] bg-brand/60 px-0 text-text">
        {text.slice(idx, idx + q.length)}
      </mark>
    );
    i = idx + q.length;
  }
  return <>{parts}</>;
}

/**
 * 适配类型(顶栏「适配类型」):按类别分组列出全部可预览的扩展名。
 * 数据来自格式注册表 supportedTypes()(与路由同序,单一事实来源)。
 * §交互修正:顶部搜索框,按扩展名 / 类别描述过滤,匹配子串高亮。
 */
export function SupportedTypesDialog({ open, onClose }: Props) {
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!open) return;
    setQuery(""); // 每次打开清空搜索
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const groups = supportedTypes();
  const q = query.trim().toLowerCase();

  // 过滤:类别名/描述命中 → 整组保留;否则按扩展名子串过滤;两头都不命中 → 整组去掉
  const filtered = groups
    .map((g) => {
      const label = LABELS[g.name] ?? g.name;
      if (!q) return { ...g, label, exts: g.exts };
      const labelHit = label.toLowerCase().includes(q) || g.name.toLowerCase().includes(q);
      const exts = labelHit ? g.exts : g.exts.filter((e) => e.toLowerCase().includes(q));
      if (!labelHit && exts.length === 0) return null;
      return { ...g, label, exts };
    })
    .filter((g): g is NonNullable<typeof g> => g != null);

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

        {/* 搜索框 */}
        <div className="border-b border-line px-4 py-2">
          <div className="flex items-center gap-2 rounded border border-line bg-panel-2 px-2 py-1.5 focus-within:border-brand-bright/60">
            <Search size={14} className="shrink-0 text-text-dim" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索扩展名或类别,如 jpg / 图片…"
              className="w-full bg-transparent text-xs text-text outline-none placeholder:text-text-dim/60"
            />
            {query && (
              <button
                className="shrink-0 text-text-dim hover:text-text"
                onClick={() => setQuery("")}
                title="清空"
              >
                <X size={13} />
              </button>
            )}
          </div>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-3">
          {filtered.length === 0 ? (
            <div className="py-6 text-center text-xs text-text-dim">无匹配类型</div>
          ) : (
            filtered.map((g) => (
              <section key={g.name}>
                <h3 className="mb-1.5 text-xs font-medium text-text-dim">
                  <Hi text={g.label} q={q} />
                  <span className="ml-2 text-text-dim/50">{g.exts.length} 种</span>
                </h3>
                <div className="flex flex-wrap gap-1">
                  {g.exts.map((e) => (
                    <span
                      key={e}
                      className="rounded border border-line/60 bg-panel-2 px-1.5 py-0.5 font-mono text-[11px] text-text"
                    >
                      .<Hi text={e} q={q} />
                    </span>
                  ))}
                </div>
              </section>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
