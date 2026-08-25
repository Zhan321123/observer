import { useEffect, useRef } from "react";
import { assetUrl, allowAssetPath } from "../../lib/tauri";
import { useCellViewStore } from "../../stores/cellViewStore";
import { registerControl } from "../../stores/cellControls";
import type { PreviewProps } from "../../formats/types";
import dotlottieWasmUrl from "@lottiefiles/dotlottie-web/dotlottie-player.wasm?url";
import riveWasmUrl from "@rive-app/canvas/rive.wasm?url";

/**
 * 动效预览(M4,method.md §7):dotLottie(.lottie)/ Rive(.riv)/ SVGA(.svga)。
 * 字节经 asset:// fetch(铁律 2);各播放器自带的 WASM(dotlottie-player.wasm / rive.wasm)
 * 经 Vite ?url 打包为同源资源,setWasmUrl 指过去(Rive 关掉 CDN 兜底,离线可用)。
 * 交互(layout.md §4.5):点击(已选中时)= 播放/暂停;循环播放;宫格尺寸变化自适应。
 */

/** 统一的播放句柄(屏蔽三个播放器的 API 差异) */
interface AnimHandle {
  play(): void;
  pause(): void;
  dispose(): void;
  resize(): void;
}

/** 取文件字节(asset:// → ArrayBuffer) */
async function fetchBytes(path: string): Promise<ArrayBuffer> {
  await allowAssetPath(path).catch(() => {});
  const r = await fetch(assetUrl(path));
  if (!r.ok) throw new Error(`读取文件失败(${r.status})`);
  return r.arrayBuffer();
}

/** dotLottie(.lottie):@lottiefiles/dotlottie-web(WASM) */
async function setupDotLottie(canvas: HTMLCanvasElement, buf: ArrayBuffer): Promise<AnimHandle> {
  const { DotLottie } = await import("@lottiefiles/dotlottie-web");
  DotLottie.setWasmUrl(dotlottieWasmUrl);
  const player = new DotLottie({
    canvas,
    data: buf,
    autoplay: true,
    loop: true,
    renderConfig: { autoResize: true, devicePixelRatio: window.devicePixelRatio || 1 },
  });
  return {
    play: () => player.play(),
    pause: () => player.pause(),
    dispose: () => player.destroy(),
    resize: () => player.resize(),
  };
}

/** Rive(.riv):@rive-app/canvas(WASM) */
async function setupRive(canvas: HTMLCanvasElement, buf: ArrayBuffer): Promise<AnimHandle> {
  const mod = await import("@rive-app/canvas");
  // UMD 无可靠命名导出(Node/Rollup interop 下命名导入可能为 undefined),经 default 兜底取
  const ns = (mod as unknown as { default?: typeof mod }).default ?? mod;
  const { Rive, Layout, Fit, Alignment, RuntimeLoader } = ns;
  RuntimeLoader.setWasmUrl(riveWasmUrl);
  RuntimeLoader.setWasmFallbackUrl(null); // 离线:不走 jsdelivr CDN 兜底
  let rive: InstanceType<typeof Rive> | null = null;
  await new Promise<void>((resolve, reject) => {
    rive = new Rive({
      canvas,
      buffer: buf,
      autoplay: true,
      layout: new Layout({ fit: Fit.Contain, alignment: Alignment.Center }),
      onLoad: () => {
        try {
          rive?.resizeDrawingSurfaceToCanvas();
        } catch {
          // 尺寸异常不影响播放
        }
        resolve();
      },
      onLoadError: () => reject(new Error("Rive 解析失败")),
    });
  });
  const r = rive!;
  return {
    play: () => r.play(),
    pause: () => r.pause(),
    dispose: () => r.cleanup(),
    resize: () => {
      try {
        r.resizeDrawingSurfaceToCanvas();
      } catch {
        // 忽略
      }
    },
  };
}

/** SVGA(.svga):svgaplayerweb(纯 JS,无 WASM);UMD 无 ESM,取 default 或命名空间兜底 */
async function setupSvga(canvas: HTMLCanvasElement, buf: ArrayBuffer): Promise<AnimHandle> {
  const mod = await import("svgaplayerweb");
  const SVGA = ((mod as unknown as { default?: unknown }).default ?? mod) as {
    Parser: new () => { load(url: string, ok: (v: unknown) => void, fail?: (e: Error) => void): void };
    Player: new (el: HTMLCanvasElement) => {
      loops: number;
      clearsAfterStop: boolean;
      setVideoItem(v: unknown): void;
      setContentMode(m: "Fill" | "AspectFill" | "AspectFit"): void;
      startAnimation(): void;
      pauseAnimation(): void;
      stopAnimation(): void;
      clear(): void;
    };
  };
  // Parser.load 走 XHR:用 blob URL(同源安全,规避 asset:// 自定义协议的 XHR 兼容问题)
  const blobUrl = URL.createObjectURL(new Blob([buf]));
  try {
    const player = await new Promise<InstanceType<typeof SVGA.Player>>((resolve, reject) => {
      new SVGA.Parser().load(
        blobUrl,
        (videoItem) => {
          const p = new SVGA.Player(canvas);
          p.setVideoItem(videoItem);
          p.setContentMode("AspectFit");
          p.loops = 0; // 无限循环
          p.clearsAfterStop = false;
          p.startAnimation();
          resolve(p);
        },
        (e) => reject(e ?? new Error("SVGA 解析失败"))
      );
    });
    return {
      play: () => player.startAnimation(),
      pause: () => player.pauseAnimation(),
      dispose: () => {
        player.stopAnimation();
        player.clear();
      },
      resize: () => {
        // SVGA 按 canvas 尺寸渲染;尺寸由外层 effect 维护
      },
    };
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
}

export function AnimView({ file, cellId, active }: PreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const setView = useCellViewStore((s) => s.setView);
  const playing = useCellViewStore((s) => s.views[cellId]?.playing) ?? true;
  const handleRef = useRef<AnimHandle | null>(null);
  /** 当前格式(SVGA 需手动同步 canvas 像素尺寸;dotLottie/Rive 自管理) */
  const extRef = useRef("");

  // 加载与构建(file/cell 变化时重来)
  useEffect(() => {
    let cancelled = false;
    extRef.current = file.ext.toLowerCase();
    setView(cellId, { playing: true });
    (async () => {
      try {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const buf = await fetchBytes(file.path);
        if (cancelled) return;
        const ext = file.ext.toLowerCase();
        const handle =
          ext === "lottie"
            ? await setupDotLottie(canvas, buf)
            : ext === "riv"
              ? await setupRive(canvas, buf)
              : await setupSvga(canvas, buf);
        if (cancelled) {
          handle.dispose();
          return;
        }
        handleRef.current = handle;
      } catch (e) {
        if (!cancelled)
          setView(cellId, { error: e instanceof Error ? e.message : "动效解析失败" });
      }
    })();
    return () => {
      cancelled = true;
      handleRef.current?.dispose();
      handleRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file.path, cellId]);

  // playing 态 → 播放器(点击/功能条 toggle 改 store,这里应用)
  useEffect(() => {
    const h = handleRef.current;
    if (!h) return;
    if (playing) h.play();
    else h.pause();
  }, [playing]);

  // 容器尺寸变化 → 通知播放器(SVGA 需手动同步 canvas 像素尺寸;dotLottie/Rive 自管理)
  useEffect(() => {
    const c = containerRef.current;
    const canvas = canvasRef.current;
    if (!c || !canvas) return;
    const ro = new ResizeObserver(() => {
      if (extRef.current === "svga") {
        const dpr = window.devicePixelRatio || 1;
        canvas.width = Math.max(1, Math.floor(c.clientWidth * dpr));
        canvas.height = Math.max(1, Math.floor(c.clientHeight * dpr));
      }
      handleRef.current?.resize();
    });
    ro.observe(c);
    return () => ro.disconnect();
  }, []);

  // 命令式控制(功能条播放/暂停)
  useEffect(
    () =>
      registerControl(cellId, {
        kind: "anim",
        toggle: () => {
          const cur = useCellViewStore.getState().views[cellId]?.playing ?? true;
          setView(cellId, { playing: !cur });
        },
      }),
    [cellId, setView]
  );

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full overflow-hidden bg-panel-2/40"
      style={{ cursor: active ? "pointer" : "default" }}
      onClick={() => {
        // 点击(已选中时)= 播放/暂停(§4.5);未选中格的点击被 GridCell capture 拦截,不到这里
        if (!active) return;
        const cur = useCellViewStore.getState().views[cellId]?.playing ?? true;
        setView(cellId, { playing: !cur });
      }}
    >
      <canvas ref={canvasRef} className="h-full w-full" />
    </div>
  );
}
