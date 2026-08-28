import { useCallback, useEffect, useRef, useState } from "react";
import { assetUrl, allowAssetPath } from "../../lib/tauri";
import { docPosGet, docPosSet } from "../../lib/persist";
import { useCellViewStore } from "../../stores/cellViewStore";
import { registerControl } from "../../stores/cellControls";
import { ArchiveTree } from "./ArchiveTree";
import type { PreviewProps } from "../../formats/types";

/** pptx 渲染宽度(像素;页面流固定宽,缩放留后续) */
const SLIDE_W = 800;

/**
 * 文档预览(task2 二):docx(docx-preview 页面流)/ pptx(pptx-browser 幻灯片流)。
 * 双身份循 xlsx 先例:docMode 切"文档 / 压缩包目录"(功能条 toggleDocMode),
 * 目录视角复用 ArchiveTree(零改动),字节加载在目录视角下跳过。
 *
 * pptx 页面流 = 每页一个 canvas 占位 + IntersectionObserver 懒渲染(rootMargin 预取),
 * 避免 renderAllSlides 全量渲染的内存风险(100 页 ≈ 200MB);destroy() 释放 blob: URL。
 * docx-preview 的 styleContainer 必须显式传(默认注入 document.head,全局泄漏且无法清理)。
 * 滚动位置持久化(TextView 先例:500ms 防抖 + 卸载 flush,载入后恢复)。
 */
export function DocumentView({ file, cellId, active }: PreviewProps) {
  const setView = useCellViewStore((s) => s.setView);
  const setFullView = useCellViewStore((s) => s.setFullView);
  const setFullScreen = useCellViewStore((s) => s.setFullScreen);
  const docMode = useCellViewStore((s) => s.views[cellId]?.docMode) ?? "document";
  const isPptx = file.ext === "pptx";

  const scrollRef = useRef<HTMLDivElement>(null);
  /** docx 正文容器 / 样式容器(renderAsync 双容器;重载前 innerHTML="" 清场) */
  const bodyRef = useRef<HTMLDivElement>(null);
  const styleRef = useRef<HTMLDivElement>(null);
  /** pptx 渲染器(destroy 释放 blob: URL;卸载/重载必调) */
  const rendererRef = useRef<{
    renderSlide(i: number, c: HTMLCanvasElement, w: number): Promise<void>;
    slideCount: number;
    destroy(): void;
  } | null>(null);
  const [slideCount, setSlideCount] = useState(0);
  /** 幻灯片宽高比(首滑渲染成功后回填;占位默认 16:9) */
  const [aspect, setAspect] = useState<number | null>(null);
  const [rendered, setRendered] = useState(false);

  // ---- 加载(docx 渲染 / pptx 载入;目录视角跳过,切回时重跑) ----
  useEffect(() => {
    if (docMode !== "document") return;
    let cancelled = false;
    (async () => {
      await allowAssetPath(file.path).catch(() => {});
      const buf = await fetch(assetUrl(file.path)).then((r) => r.arrayBuffer());
      if (cancelled) return;
      if (isPptx) {
        const { PptxRenderer } = await import("pptx-browser");
        const r = new PptxRenderer();
        await r.load(buf);
        if (cancelled) {
          r.destroy();
          return;
        }
        rendererRef.current = r;
        setSlideCount(r.slideCount);
        setRendered(true);
      } else {
        const docx = await import("docx-preview");
        if (cancelled) return;
        if (bodyRef.current) bodyRef.current.innerHTML = "";
        if (styleRef.current) styleRef.current.innerHTML = "";
        await docx.renderAsync(buf, bodyRef.current!, styleRef.current ?? undefined, {
          inWrapper: true,
          breakPages: true,
          ignoreLastRenderedPageBreak: false,
        });
        if (cancelled) return;
        setRendered(true);
      }
      // 恢复滚动(渲染完成后才能设 scrollTop;仅每载入一次)
      const el = scrollRef.current;
      if (el) {
        const p = await docPosGet(file.path).catch(() => null);
        if (!cancelled && p && p.scroll_y != null && p.scroll_y > 0) {
          el.scrollTop = p.scroll_y;
        }
      }
    })().catch(() => {
      if (!cancelled) setView(cellId, { error: "文档解析失败(文件损坏或格式异常)" });
    });
    return () => {
      cancelled = true;
      rendererRef.current?.destroy();
      rendererRef.current = null;
      setRendered(false);
      setSlideCount(0);
      setAspect(null);
    };
  }, [file.path, cellId, docMode, isPptx, setView]);

  // ---- pptx 懒渲染:滑到哪渲到哪(IntersectionObserver;预取一页) ----
  useEffect(() => {
    if (!isPptx || docMode !== "document" || slideCount === 0) return;
    const root = scrollRef.current;
    if (!root) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const en of entries) {
          if (!en.isIntersecting) continue;
          const c = en.target as HTMLCanvasElement;
          io.unobserve(c);
          if (c.dataset.rendered) continue; // 已渲染(比例回填触发 effect 重跑)
          const r = rendererRef.current;
          if (!r) return;
          void r
            .renderSlide(Number(c.dataset.slide), c, SLIDE_W)
            .then(() => {
              c.dataset.rendered = "1";
              if (c.width > 0 && c.height > 0) {
                setAspect((prev) => prev ?? c.width / c.height);
              }
            })
            .catch(() => {});
        }
      },
      { root, rootMargin: "120% 0px" }
    );
    root.querySelectorAll("canvas[data-slide]").forEach((c) => {
      if (!(c as HTMLCanvasElement).dataset.rendered) io.observe(c);
    });
    return () => io.disconnect();
  }, [isPptx, docMode, slideCount, rendered]);

  // ---- 滚动持久化(TextView 先例) ----
  const posRef = useRef(0);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const persistNow = useCallback(() => {
    void docPosSet(file.path, null, 0, posRef.current, null).catch(() => {});
  }, [file.path]);
  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    posRef.current = el.scrollTop;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(persistNow, 500);
  };
  useEffect(() => {
    posRef.current = 0;
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      persistNow();
    };
  }, [persistNow]);

  // ---- 命令式控制:双身份切换 + 全屏(读 live state 防闭包过期) ----
  useEffect(
    () =>
      registerControl(cellId, {
        kind: "document",
        toggleDocMode: () => {
          const cur = useCellViewStore.getState().views[cellId]?.docMode;
          setView(cellId, { docMode: cur === "archive" ? "document" : "archive" });
        },
        enterFullView: () => setFullView(cellId),
        enterFullScreen: () => {
          setFullView(cellId);
          setFullScreen(true);
        },
      }),
    [cellId, setView, setFullView, setFullScreen]
  );

  // ---- 双身份:压缩包目录视角(early return 在全部 hooks 之后,XlsxView 先例) ----
  if (docMode === "archive") {
    return <ArchiveTree file={file} cellId={cellId} active={active} />;
  }

  return (
    <div ref={scrollRef} className="h-full overflow-y-auto bg-panel-2/40 py-4" onScroll={onScroll}>
      {isPptx ? (
        <div className="mx-auto flex w-full max-w-[840px] flex-col items-center gap-4">
          {slideCount > 0 &&
            Array.from({ length: slideCount }, (_, i) => (
              <div
                key={i}
                className="relative w-full"
                style={{ paddingBottom: `${100 / (aspect ?? 16 / 9)}%` }}
              >
                {/* canvas 尺寸由 renderSlide 命令式设置;JSX 不声明 width/height 防被 React 归位 */}
                <canvas
                  data-slide={i}
                  className="absolute inset-0 h-full w-full bg-black object-contain shadow-xl"
                />
                <span className="absolute right-1 top-1 rounded bg-black/50 px-1.5 py-0.5 text-[10px] text-white/80">
                  {i + 1} / {slideCount}
                </span>
              </div>
            ))}
        </div>
      ) : (
        <>
          {/* 样式容器:docx-preview 注入的 <style> 落在此处,随组件卸载一并清理 */}
          <div ref={styleRef} />
          <div ref={bodyRef} className="docx-scope mx-auto h-full w-full max-w-[900px] shadow-xl" />
        </>
      )}
      {!rendered && <div className="p-4 text-center text-xs text-text-dim">解析中…</div>}
    </div>
  );
}
