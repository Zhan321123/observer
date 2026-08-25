import { useCallback, useEffect, useRef, useState } from "react";
import { parseGIF, decompressFrames, type ParsedFrame } from "gifuct-js";
import { assetUrl, allowAssetPath } from "../../lib/tauri";
import { clamp } from "../../lib/format";
import { useCellViewStore, type FitMode } from "../../stores/cellViewStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { registerControl } from "../../stores/cellControls";
import type { PreviewProps } from "../../formats/types";

/** 帧数上限:防止长 GIF 全帧驻留内存 */
const MAX_FRAMES = 500;

interface Tf {
  x: number;
  y: number;
  s: number;
}

/**
 * GIF 逐帧预览(§第二批:gif 支持帧)。
 * gifuct-js 解出每帧补丁,按 disposal 规则在离屏 canvas 上增量合成(内存只占一帧),
 * 支持播放/暂停(按帧延时)与逐帧步进;帧信息写入 cellViewStore 供功能条帧控件。
 * 帧字节经 asset:// fetch(铁律 2),不经 IPC。
 *
 * 交互(§交互修正-GIF 补图片式交互):与 ImageView 一致的滚轮缩放(以鼠标为中心)+
 * 按住拖动平移,并接功能条"最佳显示/1:1/缩放"控件;帧控件保持现有。
 * 视图位置经 cellViewStore 瞬态接力(imgX/Y/S),全屏切换保留缩放/平移(不持久化)。
 */
export function GifView({ file, cellId, active }: PreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const setView = useCellViewStore((s) => s.setView);
  const fitMode = useCellViewStore((s) => s.views[cellId]?.fitMode) as FitMode | undefined;
  const transparencyGrid = useCellViewStore((s) => s.views[cellId]?.transparencyGrid) ?? false;
  const defaultFit = useSettingsStore((s) => s.imageDefaultFit);
  const setFullView = useCellViewStore((s) => s.setFullView);
  const setFullScreen = useCellViewStore((s) => s.setFullScreen);

  const mode: FitMode = fitMode ?? defaultFit;

  // 图片式缩放/平移变换态
  const [tf, setTf] = useState<Tf>({ x: 0, y: 0, s: 1 });
  /** GIF 逻辑尺寸(自适应/边界描边用) */
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null);

  // 解码与播放状态(全部进 ref,播放循环不依赖 React 渲染)
  const framesRef = useRef<ParsedFrame[]>([]);
  const compRef = useRef<{ canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null>(null);
  const indexRef = useRef(-1);
  const playingRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevDisposalRef = useRef(0);
  const prevDimsRef = useRef<{ left: number; top: number; width: number; height: number } | null>(null);
  const prevSnapshotRef = useRef<ImageData | null>(null);
  const [ready, setReady] = useState(false);

  /** 把离屏合成结果贴到可见 canvas */
  const blit = () => {
    const vis = canvasRef.current;
    const comp = compRef.current;
    if (!vis || !comp) return;
    if (vis.width !== comp.canvas.width) vis.width = comp.canvas.width;
    if (vis.height !== comp.canvas.height) vis.height = comp.canvas.height;
    const vctx = vis.getContext("2d");
    if (vctx) {
      vctx.clearRect(0, 0, vis.width, vis.height);
      vctx.drawImage(comp.canvas, 0, 0);
    }
  };

  const drawPatch = (f: ParsedFrame) => {
    const comp = compRef.current;
    if (!comp || !f.patch) return;
    const tmp = document.createElement("canvas");
    tmp.width = f.dims.width;
    tmp.height = f.dims.height;
    const tctx = tmp.getContext("2d");
    if (!tctx) return;
    tctx.putImageData(new ImageData(new Uint8ClampedArray(f.patch), f.dims.width, f.dims.height), 0, 0);
    comp.ctx.drawImage(tmp, f.dims.left, f.dims.top);
  };

  /** 应用"离开帧"的处置方式,再画下一帧 */
  const applyPrevDisposal = () => {
    const comp = compRef.current;
    if (!comp) return;
    const d = prevDisposalRef.current;
    const dims = prevDimsRef.current;
    if (d === 2 && dims) {
      comp.ctx.clearRect(dims.left, dims.top, dims.width, dims.height); // 恢复背景
    } else if (d === 3 && prevSnapshotRef.current) {
      comp.ctx.putImageData(prevSnapshotRef.current, 0, 0); // 恢复上一帧
    }
  };

  const compositeTo = (target: number) => {
    const frames = framesRef.current;
    const comp = compRef.current;
    if (!comp || !frames.length) return;
    if (target < indexRef.current) {
      // 回退:从头重建
      comp.ctx.clearRect(0, 0, comp.canvas.width, comp.canvas.height);
      indexRef.current = -1;
      prevDisposalRef.current = 0;
      prevSnapshotRef.current = null;
    }
    while (indexRef.current < target) {
      const next = indexRef.current + 1;
      const f = frames[next];
      applyPrevDisposal();
      if (f.disposalType === 3) {
        prevSnapshotRef.current = comp.ctx.getImageData(0, 0, comp.canvas.width, comp.canvas.height);
      }
      drawPatch(f);
      prevDisposalRef.current = f.disposalType;
      prevDimsRef.current = f.dims;
      indexRef.current = next;
    }
    setView(cellId, { gifFrame: indexRef.current });
    blit();
  };

  const scheduleNext = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    const frames = framesRef.current;
    if (!frames.length) return;
    const delay = Math.max(frames[indexRef.current]?.delay ?? 100, 20);
    timerRef.current = setTimeout(() => {
      if (!playingRef.current) return;
      compositeTo((indexRef.current + 1) % frames.length);
      scheduleNext();
    }, delay);
  };

  const setPlayingState = (p: boolean) => {
    playingRef.current = p;
    setView(cellId, { gifPlaying: p });
    if (p) scheduleNext();
    else if (timerRef.current) clearTimeout(timerRef.current);
  };

  // ---- 图片式缩放/平移(对齐 ImageView) ----
  const applyFit = useCallback(
    (m: FitMode) => {
      const c = containerRef.current;
      if (!c || !nat) return;
      const cw = c.clientWidth;
      const ch = c.clientHeight;
      let s = 1;
      if (m === "best-fit") s = Math.min(cw / nat.w, ch / nat.h);
      else if (m === "actual") s = 1;
      else return;
      const x = (cw - nat.w * s) / 2;
      const y = (ch - nat.h * s) / 2;
      setTf({ x, y, s });
      setView(cellId, { scale: s, fitMode: m });
    },
    [cellId, setView, nat]
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

  // 解码完成 → 恢复视图。优先 cellViewStore 瞬态(全屏切换接力);否则按当前模式自适应。
  useEffect(() => {
    if (!ready) return;
    const v = useCellViewStore.getState().views[cellId];
    if (v?.fitMode === "free" && v.imgX != null && v.imgY != null && v.imgS != null) {
      setTf({ x: v.imgX, y: v.imgY, s: v.imgS });
      return;
    }
    applyFit(mode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, nat]);

  // 容器尺寸变化时,若处于 best-fit/actual 则重新适配(free 不打扰)
  useEffect(() => {
    const c = containerRef.current;
    if (!c) return;
    const ro = new ResizeObserver(() => {
      if (ready && (mode === "best-fit" || mode === "actual")) applyFit(mode);
    });
    ro.observe(c);
    return () => ro.disconnect();
  }, [ready, mode, applyFit]);

  // 滚轮缩放(非 passive 才能 preventDefault)——以鼠标为中心
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

  // 缩放/平移同步到 store(供功能条缩放条显示;imgX/Y/S 为全屏切换瞬态接力)。
  // 跳过首次(挂载)写入,避免用初始 {0,0,1} 覆盖尚待恢复的瞬态(见 ready 恢复逻辑)。
  const firstRelay = useRef(true);
  useEffect(() => {
    if (firstRelay.current) {
      firstRelay.current = false;
      return;
    }
    setView(cellId, { scale: tf.s, imgX: tf.x, imgY: tf.y, imgS: tf.s });
  }, [tf, cellId, setView]);

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

  // 加载 + 解码
  useEffect(() => {
    let cancelled = false;
    setReady(false);
    setNat(null);
    (async () => {
      try {
        await allowAssetPath(file.path).catch(() => {});
        const buf = await fetch(assetUrl(file.path)).then((r) => r.arrayBuffer());
        const gif = parseGIF(buf);
        const frames = decompressFrames(gif, true).slice(0, MAX_FRAMES);
        if (cancelled) return;
        if (!frames.length) throw new Error("no frames");
        const w = gif.lsd.width;
        const h = gif.lsd.height;
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("no 2d ctx");
        compRef.current = { canvas, ctx };
        framesRef.current = frames;
        indexRef.current = -1;
        setNat({ w, h });
        setView(cellId, { gifFrameCount: frames.length, gifFrame: 0, gifPlaying: false });
        setReady(true);
        compositeTo(0);
        setPlayingState(true); // 默认自动播放
      } catch {
        if (!cancelled) setView(cellId, { error: "GIF 解析失败" });
      }
    })();
    return () => {
      cancelled = true;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file.path, cellId]);

  // 命令式控制(功能条:逐帧步进 + 播放/暂停 + 图片式缩放/适配 + 透明网格 + 全屏)
  useEffect(
    () =>
      registerControl(cellId, {
        kind: "image",
        gifStep: (dir) => {
          setPlayingState(false);
          const n = framesRef.current.length;
          if (n) compositeTo((indexRef.current + dir + n) % n);
        },
        gifTogglePlay: () => setPlayingState(!playingRef.current),
        setFitMode: (m) => applyFit(m),
        zoomIn: () => zoomTo(tf.s * 1.25),
        zoomOut: () => zoomTo(tf.s / 1.25),
        setZoom: (s) => zoomTo(s),
        toggleTransparencyGrid: () =>
          setView(cellId, {
            transparencyGrid: !(useCellViewStore.getState().views[cellId]?.transparencyGrid ?? false),
          }),
        enterFullView: () => setFullView(cellId),
        enterFullScreen: () => {
          setFullView(cellId);
          setFullScreen(true);
        },
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cellId, applyFit, zoomTo, tf.s, setView, setFullView, setFullScreen]
  );

  return (
    <div
      ref={containerRef}
      className={`relative h-full w-full overflow-hidden ${
        transparencyGrid ? "img-checkerboard" : ""
      }`}
      style={{ cursor: active ? (dragRef.current ? "grabbing" : "grab") : "default" }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      {ready ? (
        <>
          <canvas
            ref={canvasRef}
            className="pointer-events-none absolute select-none"
            style={{
              transform: `translate(${tf.x}px, ${tf.y}px) scale(${tf.s})`,
              transformOrigin: "0 0",
            }}
          />
          {/* 边界描边(§交互修正-图片边界):随 transform 走的 1px 双色环,屏幕恒定 1px */}
          {nat && (
            <div
              aria-hidden
              className="pointer-events-none absolute"
              style={{
                left: tf.x,
                top: tf.y,
                width: nat.w * tf.s,
                height: nat.h * tf.s,
                boxShadow: "0 0 0 1px rgba(0,0,0,0.55), inset 0 0 0 1px rgba(255,255,255,0.4)",
              }}
            />
          )}
        </>
      ) : (
        <div className="flex h-full w-full items-center justify-center text-xs text-text-dim">
          解码中…
        </div>
      )}
    </div>
  );
}
