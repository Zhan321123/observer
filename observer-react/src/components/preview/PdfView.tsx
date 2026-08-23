import { useEffect, useRef, useState } from "react";
import { assetUrl, allowAssetPath } from "../../lib/tauri";
import { clamp } from "../../lib/format";
import { useCellViewStore } from "../../stores/cellViewStore";
import { registerControl } from "../../stores/cellControls";
import type { PreviewProps } from "../../formats/types";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";

/**
 * PDF 预览(§第三批新增)。
 * 用 pdf.js 渲染(WebView2 自带 PDF 查看器对 Tauri asset:// 自定义协议不可靠,会上游崩溃/空白)。
 * 字节经 asset:// fetch(铁律 2);pdfjs-dist 动态 import 做代码分割,不拖累主包。
 * 页码/缩放写入 store 供功能条翻页与缩放;canvas 按 devicePixelRatio 渲染保证清晰。
 */
export function PdfView({ file, cellId }: PreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const setView = useCellViewStore((s) => s.setView);
  const page = useCellViewStore((s) => s.views[cellId]?.pdfPage) ?? 0;
  const scale = useCellViewStore((s) => s.views[cellId]?.pdfScale) ?? 1;
  const setFullView = useCellViewStore((s) => s.setFullView);
  const setFullScreen = useCellViewStore((s) => s.setFullScreen);

  const docRef = useRef<PDFDocumentProxy | null>(null);
  const [ready, setReady] = useState(false);

  // 加载文档(动态 import pdf.js;字节经 asset://)
  useEffect(() => {
    let cancelled = false;
    setReady(false);
    (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(
          "pdfjs-dist/build/pdf.worker.min.mjs",
          import.meta.url
        ).toString();
        await allowAssetPath(file.path).catch(() => {});
        const buf = await fetch(assetUrl(file.path)).then((r) => r.arrayBuffer());
        const doc = await pdfjs.getDocument({ data: buf }).promise;
        if (cancelled) {
          void doc.loadingTask.destroy();
          return;
        }
        docRef.current = doc;
        setView(cellId, { pdfPageCount: doc.numPages, pdfPage: 0, pdfScale: 1 });
        setReady(true);
      } catch {
        if (!cancelled) setView(cellId, { error: "PDF 解析失败(文件损坏或格式异常)" });
      }
    })();
    return () => {
      cancelled = true;
      void docRef.current?.loadingTask.destroy();
      docRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file.path, cellId]);

  // 渲染当前页(page/scale 变化时重渲染;先取消上一次渲染)
  useEffect(() => {
    if (!ready) return;
    const doc = docRef.current;
    const canvas = canvasRef.current;
    if (!doc || !canvas) return;
    let cancelled = false;
    let task: RenderTask | null = null;
    (async () => {
      try {
        const p = await doc.getPage(page + 1); // pdf.js 页码 1 基
        if (cancelled) return;
        const dpr = window.devicePixelRatio || 1;
        const viewport = p.getViewport({ scale: scale * dpr });
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        canvas.style.width = `${Math.floor(viewport.width / dpr)}px`;
        canvas.style.height = `${Math.floor(viewport.height / dpr)}px`;
        task = p.render({ canvas, viewport });
        await task.promise;
      } catch {
        // 重复渲染触发的 RenderingCancelledException 属预期,忽略
      }
    })();
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [ready, page, scale]);

  // 命令式控制(功能条翻页 / 缩放 / 全屏);读 live store 避免闭包过期
  useEffect(
    () =>
      registerControl(cellId, {
        kind: "pdf",
        pdfStep: (dir) => {
          const v = useCellViewStore.getState().views[cellId];
          const count = v?.pdfPageCount ?? 0;
          const cur = v?.pdfPage ?? 0;
          if (count) setView(cellId, { pdfPage: clamp(cur + dir, 0, count - 1) });
        },
        zoomIn: () => {
          const cur = useCellViewStore.getState().views[cellId]?.pdfScale ?? 1;
          setView(cellId, { pdfScale: clamp(cur * 1.25, 0.2, 8) });
        },
        zoomOut: () => {
          const cur = useCellViewStore.getState().views[cellId]?.pdfScale ?? 1;
          setView(cellId, { pdfScale: clamp(cur / 1.25, 0.2, 8) });
        },
        setZoom: (s) => setView(cellId, { pdfScale: clamp(s, 0.2, 8) }),
        enterFullView: () => setFullView(cellId),
        enterFullScreen: () => {
          setFullView(cellId);
          setFullScreen(true);
        },
      }),
    [cellId, setView, setFullView, setFullScreen]
  );

  return (
    <div className="flex h-full w-full items-start justify-center overflow-auto bg-panel-2/40 p-3">
      {ready ? (
        <canvas ref={canvasRef} className="shadow-xl" />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-xs text-text-dim">
          解析中…
        </div>
      )}
    </div>
  );
}
