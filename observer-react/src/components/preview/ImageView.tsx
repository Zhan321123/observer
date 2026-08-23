import { useCallback, useEffect, useRef, useState } from "react";
import { assetUrl } from "../../lib/tauri";
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
 */
export function ImageView({ file, cellId, active }: PreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [tf, setTf] = useState<Tf>({ x: 0, y: 0, s: 1 });
  const [loaded, setLoaded] = useState(false);

  const setView = useCellViewStore((s) => s.setView);
  const fitMode = useCellViewStore((s) => s.views[cellId]?.fitMode) as FitMode | undefined;
  const defaultFit = useSettingsStore((s) => s.imageDefaultFit);
  const setFullView = useCellViewStore((s) => s.setFullView);
  const setFullScreen = useCellViewStore((s) => s.setFullScreen);

  const mode: FitMode = fitMode ?? defaultFit;

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

  // 初次加载完成 → 按当前模式适配
  useEffect(() => {
    if (loaded) applyFit(mode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  // 容器尺寸变化时,若处于 best-fit/actual 则重新适配
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
        enterFullView: () => setFullView(cellId),
        enterFullScreen: () => {
          setFullView(cellId);
          setFullScreen(true);
        },
      }),
    [cellId, applyFit, zoomTo, tf.s, setFullView, setFullScreen]
  );

  // 视图态清理由 gridStore 在文件变更/关格/缩容时处理;全界面切换不清理,位置得以保留
  return (
    <div
      ref={containerRef}
      className="relative h-full w-full overflow-hidden"
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
