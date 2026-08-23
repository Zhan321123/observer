import { useEffect, useRef, useState } from "react";
import { parseGIF, decompressFrames, type ParsedFrame } from "gifuct-js";
import { assetUrl, allowAssetPath } from "../../lib/tauri";
import { useCellViewStore } from "../../stores/cellViewStore";
import { registerControl } from "../../stores/cellControls";
import type { PreviewProps } from "../../formats/types";

/** 帧数上限:防止长 GIF 全帧驻留内存 */
const MAX_FRAMES = 500;

/**
 * GIF 逐帧预览(§第二批:gif 支持帧)。
 * gifuct-js 解出每帧补丁,按 disposal 规则在离屏 canvas 上增量合成(内存只占一帧),
 * 支持播放/暂停(按帧延时)与逐帧步进;帧信息写入 cellViewStore 供功能条帧控件。
 * 帧字节经 asset:// fetch(铁律 2),不经 IPC。
 */
export function GifView({ file, cellId, active }: PreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const setView = useCellViewStore((s) => s.setView);
  const transparencyGrid = useCellViewStore((s) => s.views[cellId]?.transparencyGrid) ?? false;
  const setFullView = useCellViewStore((s) => s.setFullView);
  const setFullScreen = useCellViewStore((s) => s.setFullScreen);

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

  // 加载 + 解码
  useEffect(() => {
    let cancelled = false;
    setReady(false);
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

  // 命令式控制(功能条:逐帧步进 + 播放/暂停)
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
        enterFullView: () => setFullView(cellId),
        enterFullScreen: () => {
          setFullView(cellId);
          setFullScreen(true);
        },
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cellId, setFullView, setFullScreen]
  );

  void active; // 帧控件由功能条驱动,格内无额外交互

  return (
    <div
      className={`flex h-full w-full items-center justify-center overflow-hidden ${
        transparencyGrid ? "img-checkerboard" : ""
      }`}
    >
      {ready ? (
        <canvas ref={canvasRef} className="max-h-full max-w-full object-contain" />
      ) : (
        <div className="text-xs text-text-dim">解码中…</div>
      )}
    </div>
  );
}
