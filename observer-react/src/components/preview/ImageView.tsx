import { useCallback, useEffect, useRef, useState } from "react";
import { assetUrl, readTextFile } from "../../lib/tauri";
import { docPosGet, docPosSet } from "../../lib/persist";
import { highlight } from "../../lib/highlight";
import { clamp } from "../../lib/format";
import { useCellViewStore, type FitMode } from "../../stores/cellViewStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { registerControl } from "../../stores/cellControls";
import type { PreviewProps } from "../../formats/types";

interface Tf {
  x: number;
  y: number;
  s: number;
}

/**
 * 图片预览(§4.5):选中格内滚轮以鼠标位置为中心缩放、按住拖动平移。
 * 模式:best-fit(适应宫格)/ actual(1:1)/ free(手动缩放后),三者联动(§5 注)。
 * 视图位置持久化:用户手动缩放/平移后(free)经 doc_position 落盘,重开/重启恢复;
 * 自动适配(best-fit/actual)不落盘,载入时按宫格尺寸重算以保持自适应。
 */
export function ImageView({ file, cellId, active }: PreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [tf, setTf] = useState<Tf>({ x: 0, y: 0, s: 1 });
  const [loaded, setLoaded] = useState(false);

  const setView = useCellViewStore((s) => s.setView);
  const fitMode = useCellViewStore((s) => s.views[cellId]?.fitMode) as FitMode | undefined;
  const transparencyGrid = useCellViewStore((s) => s.views[cellId]?.transparencyGrid) ?? false;
  const svgMode = useCellViewStore((s) => s.views[cellId]?.svgMode) ?? "preview";
  const defaultFit = useSettingsStore((s) => s.imageDefaultFit);
  const setFullView = useCellViewStore((s) => s.setFullView);
  const setFullScreen = useCellViewStore((s) => s.setFullScreen);

  const mode: FitMode = fitMode ?? defaultFit;
  const isSvg = file.ext === "svg";
  const showSvgText = isSvg && svgMode === "text";
  const [svgText, setSvgText] = useState<string | null>(null);

  // svg 文本模式:读源码(svg 即 XML 文本,经 readTextFile)
  useEffect(() => {
    if (!showSvgText) return;
    let cancelled = false;
    setSvgText(null);
    readTextFile(file.path)
      .then((t) => {
        if (!cancelled) setSvgText(t);
      })
      .catch((e) => setView(cellId, { error: String(e) }));
    return () => {
      cancelled = true;
    };
  }, [showSvgText, file.path, cellId, setView]);

  // 持久化辅助:tfRef 记最新变换;userMoved 区分"用户自定义(free)"与"自动适配"
  const tfRef = useRef(tf);
  const userMoved = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const applyFit = useCallback(
    (m: FitMode) => {
      const c = containerRef.current;
      const img = imgRef.current;
      if (!c || !img || !img.naturalWidth) return;
      const cw = c.clientWidth;
      const ch = c.clientHeight;
      const iw = img.naturalWidth;
      const ih = img.naturalHeight;
      let s = 1;
      if (m === "best-fit") s = Math.min(cw / iw, ch / ih);
      else if (m === "actual") s = 1;
      else return;
      const x = (cw - iw * s) / 2;
      const y = (ch - ih * s) / 2;
      userMoved.current = false; // 自动适配,不持久化
      setTf({ x, y, s });
      setView(cellId, { scale: s, fitMode: m });
    },
    [cellId, setView]
  );

  /** 以容器中心为锚点缩放到目标倍率 */
  const zoomTo = useCallback(
    (target: number) => {
      const c = containerRef.current;
      if (!c) return;
      const cx = c.clientWidth / 2;
      const cy = c.clientHeight / 2;
      userMoved.current = true;
      setTf((prev) => {
        const s2 = clamp(target, 0.02, 40);
        return {
          s: s2,
          x: cx - (cx - prev.x) * (s2 / prev.s),
          y: cy - (cy - prev.y) * (s2 / prev.s),
        };
      });
      setView(cellId, { fitMode: "free", scale: target });
    },
    [cellId, setView]
  );

  // 载入完成 → 有持久化记录则恢复上次视图(记为 free),否则按当前模式自适应
  useEffect(() => {
    if (!loaded) return;
    let cancelled = false;
    docPosGet(file.path)
      .then((p) => {
        if (cancelled) return;
        if (p && p.zoom != null && p.scroll_x != null && p.scroll_y != null) {
          userMoved.current = true;
          setTf({ x: p.scroll_x, y: p.scroll_y, s: p.zoom });
          setView(cellId, { fitMode: "free", scale: p.zoom });
        } else {
          applyFit(mode);
        }
      })
      .catch(() => applyFit(mode));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  // 容器尺寸变化时,若处于 best-fit/actual 则重新适配(free 不打扰)
  useEffect(() => {
    const c = containerRef.current;
    if (!c) return;
    const ro = new ResizeObserver(() => {
      if (loaded && (mode === "best-fit" || mode === "actual")) applyFit(mode);
    });
    ro.observe(c);
    return () => ro.disconnect();
  }, [loaded, mode, applyFit]);

  // 滚轮缩放(非 passive,才能 preventDefault 阻止滚动)——以鼠标为中心
  useEffect(() => {
    const c = containerRef.current;
    if (!c) return;
    const onWheel = (e: WheelEvent) => {
      if (!active) return;
      e.preventDefault();
      const rect = c.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      userMoved.current = true;
      setTf((prev) => {
        const k = Math.exp(-e.deltaY * 0.0015);
        const s2 = clamp(prev.s * k, 0.02, 40);
        return {
          s: s2,
          x: cx - (cx - prev.x) * (s2 / prev.s),
          y: cy - (cy - prev.y) * (s2 / prev.s),
        };
      });
      setView(cellId, { fitMode: "free" });
    };
    c.addEventListener("wheel", onWheel, { passive: false });
    return () => c.removeEventListener("wheel", onWheel);
  }, [active, cellId, setView]);

  // 缩放时同步倍率到 store(供功能条缩放条显示)
  useEffect(() => {
    setView(cellId, { scale: tf.s });
  }, [tf.s, cellId, setView]);

  // ---- 视图位置持久化(仅 free / 用户自定义时落盘) ----
  useEffect(() => {
    tfRef.current = tf;
  }, [tf]);

  const persistNow = useCallback(() => {
    if (!userMoved.current) return; // 自动适配结果不落盘
    const t = tfRef.current;
    void docPosSet(file.path, null, t.x, t.y, t.s).catch(() => {});
  }, [file.path]);

  // tf 变化防抖 500ms 落盘
  useEffect(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(persistNow, 500);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [tf, persistNow]);

  // 卸载(关格/退出)时落盘
  useEffect(
    () => () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      persistNow();
    },
    [persistNow]
  );

  // 拖拽平移(pointer capture)
  const dragRef = useRef<{ px: number; py: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    if (!active) return;
    dragRef.current = { px: e.clientX, py: e.clientY };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    userMoved.current = true;
    const dx = e.clientX - d.px;
    const dy = e.clientY - d.py;
    d.px = e.clientX;
    d.py = e.clientY;
    setTf((prev) => ({ ...prev, x: prev.x + dx, y: prev.y + dy }));
  };
  const onPointerUp = () => {
    dragRef.current = null;
  };

  // 注册命令式控制(供功能条调用)
  useEffect(
    () =>
      registerControl(cellId, {
        kind: "image",
        setFitMode: (m) => applyFit(m),
        zoomIn: () => zoomTo(tf.s * 1.25),
        zoomOut: () => zoomTo(tf.s / 1.25),
        setZoom: (s) => zoomTo(s),
        toggleTransparencyGrid: () =>
          setView(cellId, {
            transparencyGrid: !(useCellViewStore.getState().views[cellId]?.transparencyGrid ?? false),
          }),
        toggleSvgMode: () =>
          setView(cellId, {
            svgMode:
              (useCellViewStore.getState().views[cellId]?.svgMode ?? "preview") === "preview"
                ? "text"
                : "preview",
          }),
        enterFullView: () => setFullView(cellId),
        enterFullScreen: () => {
          setFullView(cellId);
          setFullScreen(true);
        },
      }),
    [cellId, applyFit, zoomTo, tf.s, setFullView, setFullScreen]
  );

  // 视图态清理由 gridStore 在文件变更/关格/缩容时处理;全界面切换不清理,位置得以保留
  // svg 文本模式:显示高亮源码(不进 pan/zoom)
  if (showSvgText) {
    return (
      <div className="h-full w-full overflow-auto" style={{ userSelect: "text" }}>
        {svgText == null ? (
          <div className="p-4 text-xs text-text-dim">加载中…</div>
        ) : (
          <pre
            className="m-0 whitespace-pre-wrap break-all p-4 font-mono text-[12px] leading-relaxed text-text"
            dangerouslySetInnerHTML={{ __html: highlight(svgText, "xml") }}
          />
        )}
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={`relative h-full w-full overflow-hidden ${transparencyGrid ? "img-checkerboard" : ""}`}
      style={{ cursor: active ? (dragRef.current ? "grabbing" : "grab") : "default" }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      <img
        ref={imgRef}
        src={assetUrl(file.path)}
        alt={file.name}
        draggable={false}
        onLoad={() => setLoaded(true)}
        onError={() => setView(cellId, { error: "无法加载图片(文件损坏或格式异常)" })}
        className="pointer-events-none absolute select-none"
        style={{
          transform: `translate(${tf.x}px, ${tf.y}px) scale(${tf.s})`,
          transformOrigin: "0 0",
          maxWidth: "none",
          maxHeight: "none",
        }}
      />
    </div>
  );
}
