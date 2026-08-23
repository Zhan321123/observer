import { useEffect, useMemo, useState } from "react";
import MarkdownIt from "markdown-it";
import { readTextFile } from "../../lib/tauri";
import { highlight } from "../../lib/highlight";
import { useCellViewStore } from "../../stores/cellViewStore";
import { registerControl } from "../../stores/cellControls";
import type { PreviewProps } from "../../formats/types";

const md = new MarkdownIt({ html: false, linkify: true, breaks: false });

/**
 * 文本 / 代码 / markdown 预览(§4.5:滚轮滚动)。
 * markdown → markdown-it 渲染;代码 → 零依赖高亮;纯文本 → <pre>。
 */
export function TextView({ file, cellId }: PreviewProps) {
  const [text, setText] = useState<string | null>(null);
  const [fontSize, setFontSize] = useState(13);
  const setView = useCellViewStore((s) => s.setView);

  useEffect(() => {
    let cancelled = false;
    setText(null);
    readTextFile(file.path)
      .then((t) => {
        if (!cancelled) setText(t);
      })
      .catch((e) => setView(cellId, { error: String(e) }));
    return () => {
      cancelled = true;
    };
  }, [file.path, cellId, setView]);

  const isMd = file.kind === "markdown";

  const html = useMemo(() => {
    if (text == null) return "";
    return isMd ? md.render(text) : highlight(text, file.ext);
  }, [text, isMd, file.ext]);

  // 文本缩放控制(功能条 zoom −/+)
  useEffect(
    () =>
      registerControl(cellId, {
        kind: isMd ? "markdown" : "text",
        zoomText: (delta) => setFontSize((s) => Math.min(32, Math.max(8, s + delta))),
      }),
    [cellId, isMd]
  );

  useEffect(() => {
    setView(cellId, { fontSize });
  }, [fontSize, cellId, setView]);

  if (text == null) {
    return (
      <div className="flex h-full w-full items-center justify-center text-text-dim">加载中…</div>
    );
  }

  return (
    <div className="h-full w-full overflow-auto p-4" style={{ userSelect: "text" }}>
      {isMd ? (
        <div className="md-body" style={{ fontSize }} dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <pre
          className="m-0 font-mono leading-relaxed"
          style={{ fontSize }}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      )}
    </div>
  );
}
