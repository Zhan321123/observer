import { useCallback, useEffect, useRef, useState } from "react";
import { assetUrl, allowAssetPath } from "../../lib/tauri";
import { docPosGet, docPosSet } from "../../lib/persist";
import { clamp } from "../../lib/format";
import { useCellViewStore } from "../../stores/cellViewStore";
import { registerControl } from "../../stores/cellControls";
import type { PreviewProps } from "../../formats/types";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";

/** 缩放范围(视图倍率);渲染分辨率另设上限防超大画布 */
const MIN_S = 0.2;
const MAX_S = 8;
/** 画布渲染分辨率上限(视图可交互到 MAX_S,超出部分由 transform 放大,略糊但省内存) */
const RENDER_MAX_S = 4;
/** 点击/拖拽判定阈值(px):位移小于它算点击(触发热区翻页),否则算拖拽(平移) */
const DRAG_THRESHOLD = 6;

interface Tf {
  x: number;
  y: number;
  s: number;
}

/** 左/右 1/3 热区的 ←/→ 光标:SVG data URI(黑描边白箭头,任意底色可辨),w/e-resize 兜底 */
function arrowCursor(dir: "left" | "right"): string {
  const d = dir === "left" ? "M15 5 L8 12 L15 19" : "M9 5 L16 12 L9 19";
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'>` +
    `<path d='${d}' fill='none' stroke='black' stroke-width='5' stroke-linecap='round' stroke-linejoin='round'/>` +
    `<path d='${d}' fill='none' stroke='white' stroke-width='2.6' stroke-linecap='round' stroke-linejoin='round'/>` +
    `</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") 12 12, ${
    dir === "left" ? "w-resize" : "e-resize"
  }`;
}
const CURSOR_LEFT = arrowCursor("left");
const CURSOR_RIGHT = arrowCursor("right");

/**
 * PDF 预览(§第三批新增)。
 * 用 pdf.js 渲染(WebView2 自带 PDF 查看器对 Tauri asset:// 自定义协议不可靠,会上游崩溃/空白)。
 * 字节经 asset:// fetch(铁律 2);pdfjs-dist 动态 import 做代码分割,不拖累主包。
 * 页码/缩放写入 store 供功能条翻页与缩放;canvas 按 devicePixelRatio 渲染保证清晰。
 *
 * 格内交互(§交互修正-PDF):滚轮=以鼠标为中心缩放;放大后按住拖动=平移;
 * 左右各 1/3 宽度热区(光标 ←/→),点击=上一页/下一页;宫格/全窗/全屏行为一致(active 时生效)。
 * 缩放流畅度:交互期只动 transform(即时),去抖后按当前倍率重渲染画布(保清晰,不跳变)。
 */
export function PdfView({ file, cellId, active }: PreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const setView = useCellViewStore((s) => s.setView);
  const page = useCellViewStore((s) => s.views[cellId]?.pdfPage) ?? 0;
  const setFullView = useCellViewStore((s) => s.setFullView);
  const setFullScreen = useCellViewStore((s) => s.setFullScreen);

  const docRef = useRef<PDFDocumentProxy | null>(null);
  const [ready, setReady] = useState(false);

  // 交互变换(即时,tf.s=视图倍率)与渲染分辨率(去抖后跟上,保清晰)
  const [tf, setTf] = useState<Tf>({ x: 0, y: 0, s: 1 });
  const [renderScale, setRenderScale] = useState(1);
  /** 当前页 scale=1 尺寸(state 触发 fit/居中,ref 供同步读取) */
  const [pageInfo, setPageInfo] = useState<{ w: number; h: number } | null>(null);
  const pageSizeRef = useRef<{ w: number; h: number } | null>(null);
  const userMoved = useRef(false);
  const tfRef = useRef(tf);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [hover, setHover] = useState<"left" | "right" | "mid" | null>(null);

  useEffect(() => {
    tfRef.current = tf;
  }, [tf]);

  // 加载文档(动态 import pdf.js;字节经 asset://)
  useEffect(() => {
    let cancelled = false;
    setReady(false);
    setPageInfo(null);
    pageSizeRef.current = null;
    userMoved.current = false;
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
        // 恢复页码/缩放(M4-PDF 持久化):① 瞬态(全屏接力,store 已有 pdfPage)
        //   ② doc_position(重启/重开)③ 默认第 0 页自适应。
        const v = useCellViewStore.getState().views[cellId];
        let restorePage = 0;
        let restoreTf: Tf | null = null;
        if (v?.pdfPage != null) {
          restorePage = v.pdfPage;
          if (v.pdfX != null && v.pdfY != null && v.pdfScale != null) {
            restoreTf = { x: v.pdfX, y: v.pdfY, s: v.pdfScale };
          }
        } else {
          const p = await docPosGet(file.path).catch(() => null);
          if (cancelled) return;
          if (p) {
            if (p.page != null) restorePage = p.page;
            if (p.zoom != null && p.scroll_x != null && p.scroll_y != null) {
              restoreTf = { x: p.scroll_x, y: p.scroll_y, s: p.zoom };
            }
          }
        }
        restorePage = clamp(restorePage, 0, doc.numPages - 1);
        if (restoreTf) {
          userMoved.current = true;
          setTf(restoreTf);
          setRenderScale(clamp(restoreTf.s, MIN_S, RENDER_MAX_S));
        }
        setView(cellId, {
          pdfPageCount: doc.numPages,
          pdfPage: restorePage,
          pdfScale: restoreTf?.s ?? 1,
        });
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

  // 渲染当前页(page/renderScale 变化时重渲染;先取消上一次渲染)。renderScale 去抖更新,交互期不动它。
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
        // 记录页尺寸(scale=1),供自适应/居中
        const v1 = p.getViewport({ scale: 1 });
        const pw = v1.width;
        const ph = v1.height;
        const cur = pageSizeRef.current;
        if (!cur || cur.w !== pw || cur.h !== ph) {
          pageSizeRef.current = { w: pw, h: ph };
          setPageInfo({ w: pw, h: ph });
        }
        const dpr = window.devicePixelRatio || 1;
        const viewport = p.getViewport({ scale: renderScale * dpr });
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
  }, [ready, page, renderScale]);

  // 自适应/居中:载入与翻页时,未手动缩放则按宫格尺寸 best-fit 并居中;已手动缩放则保持倍率仅重新居中
  useEffect(() => {
    if (!pageInfo) return;
    const c = containerRef.current;
    if (!c) return;
    const cw = c.clientWidth;
    const ch = c.clientHeight;
    const fitS = clamp(Math.min(cw / pageInfo.w, ch / pageInfo.h), MIN_S, MAX_S);
    const s = userMoved.current ? tfRef.current.s : fitS;
    setTf({ x: (cw - pageInfo.w * s) / 2, y: (ch - pageInfo.h * s) / 2, s });
    if (!userMoved.current) setRenderScale(Math.min(fitS, RENDER_MAX_S));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageInfo, page]);

  // 容器尺寸变化:未手动缩放时重新 best-fit(手动缩放/平移后不打扰)
  useEffect(() => {
    const c = containerRef.current;
    if (!c) return;
    const ro = new ResizeObserver(() => {
      const ps = pageSizeRef.current;
      if (!ps || userMoved.current) return;
      const cw = c.clientWidth;
      const ch = c.clientHeight;
      const s = clamp(Math.min(cw / ps.w, ch / ps.h), MIN_S, MAX_S);
      setTf({ x: (cw - ps.w * s) / 2, y: (ch - ps.h * s) / 2, s });
      setRenderScale(Math.min(s, RENDER_MAX_S));
    });
    ro.observe(c);
    return () => ro.disconnect();
  }, []);

  // 视图倍率去抖落到渲染分辨率:交互停顿后按当前倍率重渲染(屏幕尺寸不变,只换清晰版)
  useEffect(() => {
    const t = setTimeout(
      () => setRenderScale(clamp(tf.s, MIN_S, RENDER_MAX_S)),
      180
    );
    return () => clearTimeout(t);
  }, [tf.s]);

  // 视图倍率同步到 store(功能条百分比显示);手动缩放/平移时把 x/y 一并存入(全屏切换瞬态接力)
  useEffect(() => {
    setView(
      cellId,
      userMoved.current ? { pdfScale: tf.s, pdfX: tf.x, pdfY: tf.y } : { pdfScale: tf.s }
    );
  }, [tf, cellId, setView]);

  // ---- 页码/缩放位置持久化(M4-PDF,doc_position;page 恒记,zoom/pan 仅手动缩放后) ----
  const persistNow = useCallback(() => {
    if (!ready) return;
    const pg = useCellViewStore.getState().views[cellId]?.pdfPage ?? 0;
    if (userMoved.current) {
      const t = tfRef.current;
      void docPosSet(file.path, pg, t.x, t.y, t.s).catch(() => {});
    } else {
      void docPosSet(file.path, pg, null, null, null).catch(() => {});
    }
  }, [ready, cellId, file.path]);

  // 页码/视图变化防抖 500ms 落盘
  useEffect(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(persistNow, 500);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [page, tf, persistNow]);

  // 卸载(关格/退出/全屏切换)时落盘
  useEffect(
    () => () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      persistNow();
    },
    [persistNow]
  );

  /** 以容器中心为锚点缩放到目标倍率(功能条缩放控件) */
  const zoomTo = useCallback((target: number) => {
    const c = containerRef.current;
    if (!c) return;
    const cx = c.clientWidth / 2;
    const cy = c.clientHeight / 2;
    userMoved.current = true;
    setTf((prev) => {
      const s2 = clamp(target, MIN_S, MAX_S);
      return {
        s: s2,
        x: cx - (cx - prev.x) * (s2 / prev.s),
        y: cy - (cy - prev.y) * (s2 / prev.s),
      };
    });
  }, []);

  /** 翻页(读 live store 避免闭包过期) */
  const stepPage = useCallback(
    (dir: 1 | -1) => {
      const v = useCellViewStore.getState().views[cellId];
      const count = v?.pdfPageCount ?? 0;
      const cur = v?.pdfPage ?? 0;
      if (count) setView(cellId, { pdfPage: clamp(cur + dir, 0, count - 1) });
    },
    [cellId, setView]
  );

  // 滚轮缩放(非 passive 才能 preventDefault 阻止滚动)——以鼠标为中心
  useEffect(() => {
    const c = containerRef.current;
    if (!c) return;
    const onWheel = (e: WheelEvent) => {
      if (!active) return;
      e.preventDefault();
      userMoved.current = true;
      const rect = c.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      setTf((prev) => {
        const k = Math.exp(-e.deltaY * 0.0015);
        const s2 = clamp(prev.s * k, MIN_S, MAX_S);
        return {
          s: s2,
          x: cx - (cx - prev.x) * (s2 / prev.s),
          y: cy - (cy - prev.y) * (s2 / prev.s),
        };
      });
    };
    c.addEventListener("wheel", onWheel, { passive: false });
    return () => c.removeEventListener("wheel", onWheel);
  }, [active]);

  // 指针:拖拽平移 + 干净点击触发热区翻页 + 热区光标
  const dragRef = useRef<{ startX: number; startY: number; px: number; py: number; dragged: boolean } | null>(null);

  const onPointerDown = (e: React.PointerEvent) => {
    if (!active) return;
    dragRef.current = { startX: e.clientX, startY: e.clientY, px: e.clientX, py: e.clientY, dragged: false };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const c = containerRef.current;
    const d = dragRef.current;
    if (!d) {
      // 未按下:更新热区光标
      if (!active || !c) {
        if (hover !== null) setHover(null);
        return;
      }
      const rect = c.getBoundingClientRect();
      const fx = (e.clientX - rect.left) / rect.width;
      const zone = fx < 1 / 3 ? "left" : fx > 2 / 3 ? "right" : "mid";
      if (zone !== hover) setHover(zone);
      return;
    }
    // 按下:超阈值判定为拖拽 → 平移
    if (!d.dragged && Math.hypot(e.clientX - d.startX, e.clientY - d.startY) > DRAG_THRESHOLD) {
      d.dragged = true;
    }
    if (d.dragged) {
      userMoved.current = true;
      const dx = e.clientX - d.px;
      const dy = e.clientY - d.py;
      d.px = e.clientX;
      d.py = e.clientY;
      setTf((prev) => ({ ...prev, x: prev.x + dx, y: prev.y + dy }));
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d || d.dragged || !active) return; // 拖拽松手不翻页
    // 干净点击 → 左/右 1/3 热区翻页
    const c = containerRef.current;
    if (!c) return;
    const rect = c.getBoundingClientRect();
    const fx = (e.clientX - rect.left) / rect.width;
    if (fx < 1 / 3) stepPage(-1);
    else if (fx > 2 / 3) stepPage(1);
  };

  // 命令式控制(功能条翻页 / 缩放 / 全屏);读 live store 避免闭包过期
  useEffect(
    () =>
      registerControl(cellId, {
        kind: "pdf",
        pdfStep: (dir) => stepPage(dir),
        zoomIn: () => zoomTo(tfRef.current.s * 1.25),
        zoomOut: () => zoomTo(tfRef.current.s / 1.25),
        setZoom: (s) => zoomTo(s),
        enterFullView: () => setFullView(cellId),
        enterFullScreen: () => {
          setFullView(cellId);
          setFullScreen(true);
        },
      }),
    [cellId, stepPage, zoomTo, setFullView, setFullScreen]
  );

  const cursor = !active
    ? "default"
    : dragRef.current?.dragged
      ? "grabbing"
      : hover === "left"
        ? CURSOR_LEFT
        : hover === "right"
          ? CURSOR_RIGHT
          : "grab";

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full overflow-hidden bg-panel-2/40"
      style={{ cursor }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      {ready ? (
        <div
          className="absolute"
          style={{
            transform: `translate(${tf.x}px, ${tf.y}px) scale(${tf.s / renderScale})`,
            transformOrigin: "0 0",
          }}
        >
          <canvas ref={canvasRef} className="shadow-xl" />
        </div>
      ) : (
        <div className="flex h-full w-full items-center justify-center text-xs text-text-dim">
          解析中…
        </div>
      )}
    </div>
  );
}
