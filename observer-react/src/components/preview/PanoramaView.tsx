import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { EXRLoader } from "three/examples/jsm/loaders/EXRLoader.js";
import { RGBELoader } from "three/examples/jsm/loaders/RGBELoader.js";
import { assetUrl } from "../../lib/tauri";
import { threedGet, threedSet } from "../../lib/persist";
import { useCellViewStore } from "../../stores/cellViewStore";
import { useThreeDStore, registerThreeEngine } from "../../stores/threeDStore";
import { registerControl } from "../../stores/cellControls";
import type { FileRef } from "../../types/file";

/**
 * 全景图查看(等距柱状投影 2:1,task:全景模式):内翻球面 + 球心相机,拖拽环视 / 滚轮 FOV。
 * - 纹理:exr/hdr 走 three 的 EXR/RGBE loader(fetch asset:// 原文件字节,浮点 → ACES 色调映射
 *   + 曝光);失败回退 LDR 源(Rust 解码 PNG / 原图);jpg/png 等直接 TextureLoader。
 *   两类纹理都是 v=1=图顶(DOM 经 flipY 上传;loader 数据行序如此,与 three 环境贴图约定一致),
 *   球面 UV 无需翻 V。
 * - 交互(手动 lon/lat/fov + damp,不用 OrbitControls:球心零半径下 dolly 无意义,FOV 即缩放):
 *   按住拖动环视(抓景手感,灵敏度随 FOV 缩放)/ 滚轮 FOV 30°~110° / 自动旋转。
 * - 视角持久化:复用 threed_camera 表(按路径存 JSON,pano 标记区分 3D 视角);交互停止 500ms
 *   防抖 + 卸载落盘;全屏切换经 cellViewStore.panoCam 瞬态接力(循 threedCam 先例)。
 * - 资源配额(layout.md §4.7):与 ThreeView 共用 threeDStore 视口配额,冻结降级为最后帧截图。
 * 本组件由 ImageView 经 React.lazy 动态 import(three 全量代码分割,主包不含 three)。
 */

interface Props {
  file: FileRef;
  cellId: number;
  active: boolean;
  /** LDR 纹理源(decode-rust 类:Rust 解码 PNG 的 asset URL;原生图:原文件 asset URL) */
  fallbackSrc: string;
}

/** 持久化 JSON(复用 threed_camera;凭 pano 标记与 3D 相机 JSON 区分) */
interface PanoPersist {
  pano: true;
  lon: number;
  lat: number;
  fov: number;
  exp: number;
  spin?: boolean;
}

const HOME = { lon: 0, lat: 0, fov: 75 };
const FOV_MIN = 30;
const FOV_MAX = 110;
const LAT_MAX = 85;
/** 自动旋转角速度(度/秒) */
const SPIN_DPS = 4;

/** 经度归一到 [-180,180),落盘 JSON 不随自旋无限膨胀 */
const wrapLon = (l: number) => ((((l + 180) % 360) + 360) % 360) - 180;

/** 按扩展名加载全景纹理:exr/hdr 优先浮点原文件(保 HDR + 曝光空间),失败/其余格式走 LDR 源 */
async function loadPanoTexture(file: FileRef, fallbackSrc: string): Promise<THREE.Texture> {
  if (file.ext === "exr" || file.ext === "hdr") {
    try {
      const src = assetUrl(file.path);
      const tex =
        file.ext === "exr"
          ? await new EXRLoader().loadAsync(src)
          : await new RGBELoader().loadAsync(src);
      tex.wrapS = THREE.RepeatWrapping; // 水平环绕,防 0/360° 接缝采样断裂
      return tex;
    } catch {
      // 浮点解码失败(不认识的压缩等)→ 落到 LDR 回退,至少能看
    }
  }
  const tex = await new THREE.TextureLoader().loadAsync(fallbackSrc);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  return tex;
}

export default function PanoramaView({ file, cellId, active, fallbackSrc }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const setView = useCellViewStore((s) => s.setView);

  // 配额视口态(响应式):active=实时渲染 / frozen=截图(与 ThreeView 共用 threeDStore)
  const quotaState = useThreeDStore((s) => s.viewports[cellId]?.state ?? "active");
  const snapshot = useThreeDStore((s) => s.viewports[cellId]?.snapshot ?? null);
  const touchViewport = useThreeDStore((s) => s.touch);
  const registerViewport = useThreeDStore((s) => s.register);
  const unregisterViewport = useThreeDStore((s) => s.unregister);

  // 显示选项(响应式,功能条 active 态 + 渲染期应用)
  const autoRotate = useCellViewStore((s) => s.views[cellId]?.panoAutoRotate) ?? false;
  const exposure = useCellViewStore((s) => s.views[cellId]?.panoExposure) ?? 1;

  const [status, setStatus] = useState<"loading" | "ready">("loading");

  // ---- CPU 侧常驻(跨 freeze/activate 存活) ----
  const textureRef = useRef<THREE.Texture | null>(null);
  /** 视角目标值/当前值(当前值向目标值 damp,手感与 OrbitControls 阻尼相当) */
  const tgtRef = useRef({ ...HOME });
  const curRef = useRef({ ...HOME });
  // ---- 每激活期对象(GPU) ----
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const rafRef = useRef(0);

  const readyRef = useRef(false);
  const dirtyRef = useRef(false);
  const dragRef = useRef<{ px: number; py: number } | null>(null);
  const autoRotateRef = useRef(autoRotate);
  autoRotateRef.current = autoRotate;
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeRef = useRef(active);
  activeRef.current = active;

  /** 当前视角 + 显示选项 → threed_camera(仅 dirty 时;防抖/卸载调用) */
  const persistNow = useCallback(() => {
    if (!readyRef.current || !dirtyRef.current) return;
    const t = tgtRef.current;
    const v = useCellViewStore.getState().views[cellId];
    const payload: PanoPersist = {
      pano: true,
      lon: Math.round(wrapLon(t.lon) * 100) / 100,
      lat: Math.round(t.lat * 100) / 100,
      fov: Math.round(t.fov * 100) / 100,
      exp: v?.panoExposure ?? 1,
      spin: v?.panoAutoRotate ?? false,
    };
    void threedSet(file.path, JSON.stringify(payload)).catch(() => {});
  }, [cellId, file.path]);

  const schedulePersist = useCallback(() => {
    dirtyRef.current = true;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(persistNow, 500);
  }, [persistNow]);

  /** 视角写 cellViewStore.panoCam(全屏切换瞬态接力;带 file.path 标签防宫内换文件误用) */
  const syncPanoCam = useCallback(() => {
    const t = tgtRef.current;
    setView(cellId, { panoCam: { path: file.path, lon: t.lon, lat: t.lat, fov: t.fov } });
  }, [cellId, file.path, setView]);

  // ============================ 纹理加载与视角恢复(file/cell 变化时重来) ============================
  useEffect(() => {
    let cancelled = false;
    registerViewport(cellId);
    setStatus("loading");
    readyRef.current = false;
    dirtyRef.current = false;
    tgtRef.current = { ...HOME };
    curRef.current = { ...HOME };

    void (async () => {
      let tex: THREE.Texture;
      try {
        tex = await loadPanoTexture(file, fallbackSrc);
      } catch (e) {
        if (!cancelled) setView(cellId, { error: `全景纹理加载失败: ${String(e)}` });
        return;
      }
      if (cancelled) {
        tex.dispose();
        return;
      }
      textureRef.current = tex;

      // 视角/显示选项恢复:① 瞬态 panoCam(须属本文件)→ ② threed_camera(pano 标记)→ ③ 默认归位
      const v = useCellViewStore.getState().views[cellId];
      if (v?.panoCam && v.panoCam.path === file.path) {
        const { lon, lat, fov } = v.panoCam;
        tgtRef.current = { lon, lat, fov };
        curRef.current = { lon, lat, fov };
      } else {
        const raw = await threedGet(file.path).catch(() => null);
        if (cancelled) return;
        if (raw) {
          try {
            const j = JSON.parse(raw) as Partial<PanoPersist>;
            if (j.pano === true && typeof j.lon === "number" && typeof j.lat === "number") {
              const fov = THREE.MathUtils.clamp(
                typeof j.fov === "number" ? j.fov : HOME.fov,
                FOV_MIN,
                FOV_MAX
              );
              tgtRef.current = { lon: j.lon, lat: j.lat, fov };
              curRef.current = { lon: j.lon, lat: j.lat, fov };
              setView(cellId, { panoExposure: j.exp ?? 1, panoAutoRotate: j.spin ?? false });
            }
          } catch {
            // 视角 JSON 损坏/是 3D 相机 JSON → 用默认
          }
        }
      }

      readyRef.current = true;
      setStatus("ready");
    })();

    return () => {
      cancelled = true;
      // 卸载:接力视角(供全屏实例恢复)→ flush 持久化 → 释放纹理 → 注销视口
      if (readyRef.current) syncPanoCam();
      if (saveTimer.current) clearTimeout(saveTimer.current);
      persistNow();
      textureRef.current?.dispose();
      textureRef.current = null;
      unregisterViewport(cellId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file.path, cellId]);

  // ============================ GPU 渲染期(随配额 state 重建/释放) ============================
  useEffect(() => {
    if (status !== "ready" || quotaState !== "active") return;
    const container = containerRef.current;
    const tex = textureRef.current;
    if (!container || !tex) return;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(curRef.current.fov, 1, 0.1, 200);
    camera.position.set(0, 0, 0);
    const geo = new THREE.SphereGeometry(50, 64, 32);
    const mat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide });
    scene.add(new THREE.Mesh(geo, mat));

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      setView(cellId, { error: "无法创建 WebGL 上下文(可能已达上限)" });
      geo.dispose();
      mat.dispose();
      return;
    }
    renderer.setPixelRatio(window.devicePixelRatio || 1);
    renderer.setSize(container.clientWidth, container.clientHeight);
    camera.aspect = container.clientWidth / Math.max(1, container.clientHeight);
    camera.updateProjectionMatrix();
    // ACES 色调映射:HDR 全景(exr/hdr 浮点纹理)防高光过曝,曝光由功能条调
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = useCellViewStore.getState().views[cellId]?.panoExposure ?? 1;
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;
    cameraRef.current = camera;
    sceneRef.current = scene;

    const clock = new THREE.Clock();
    let appliedFov = camera.fov;
    const loop = () => {
      rafRef.current = requestAnimationFrame(loop);
      const dt = Math.min(clock.getDelta(), 0.1);
      if (autoRotateRef.current && !dragRef.current) tgtRef.current.lon += dt * SPIN_DPS;
      const c = curRef.current;
      const t = tgtRef.current;
      c.lon = THREE.MathUtils.damp(c.lon, t.lon, 10, dt);
      c.lat = THREE.MathUtils.damp(c.lat, t.lat, 10, dt);
      c.fov = THREE.MathUtils.damp(c.fov, t.fov, 10, dt);
      if (Math.abs(c.fov - appliedFov) > 1e-4) {
        camera.fov = c.fov;
        camera.updateProjectionMatrix();
        appliedFov = c.fov;
      }
      // lon/lat → 注视点(经典 webgl_panorama 公式;相机固在球心)
      const phi = THREE.MathUtils.degToRad(90 - c.lat);
      const theta = THREE.MathUtils.degToRad(c.lon);
      camera.lookAt(
        Math.sin(phi) * Math.cos(theta),
        Math.cos(phi),
        Math.sin(phi) * Math.sin(theta)
      );
      renderer.render(scene, camera);
    };
    loop();

    const ro = new ResizeObserver(() => {
      if (!rendererRef.current) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (w === 0 || h === 0) return;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    });
    ro.observe(container);

    return () => {
      ro.disconnect();
      cancelAnimationFrame(rafRef.current);
      geo.dispose();
      mat.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
      rendererRef.current = null;
      cameraRef.current = null;
      sceneRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, quotaState, cellId]);

  // ============================ capture 引擎(配额降级取最后一帧) ============================
  useEffect(
    () =>
      registerThreeEngine(cellId, {
        capture: () => {
          const r = rendererRef.current;
          const scene = sceneRef.current;
          const camera = cameraRef.current;
          if (!r || !scene || !camera) return null;
          try {
            r.render(scene, camera);
            return r.domElement.toDataURL("image/png");
          } catch {
            return null;
          }
        },
      }),
    [cellId]
  );

  // ============================ 交互(拖拽环视 / 滚轮 FOV) ============================
  // 滚轮改 FOV(非 passive + preventDefault;循 ImageView 滚轮缩放先例,active 才生效)
  useEffect(() => {
    const c = containerRef.current;
    if (!c || quotaState !== "active" || status !== "ready") return;
    const onWheel = (e: WheelEvent) => {
      if (!activeRef.current) return;
      e.preventDefault();
      const t = tgtRef.current;
      t.fov = THREE.MathUtils.clamp(t.fov * Math.exp(e.deltaY * 0.0012), FOV_MIN, FOV_MAX);
      schedulePersist();
    };
    c.addEventListener("wheel", onWheel, { passive: false });
    return () => c.removeEventListener("wheel", onWheel);
  }, [status, quotaState, schedulePersist]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (!active || quotaState !== "active") return;
    dragRef.current = { px: e.clientX, py: e.clientY };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    // 抓景手感:拖右 → 场景右移(看向左边);灵敏度随 FOV 缩放(拉近后微调不窜)
    const k = (tgtRef.current.fov / HOME.fov) * 0.1;
    const t = tgtRef.current;
    t.lon -= (e.clientX - d.px) * k;
    t.lat = THREE.MathUtils.clamp(t.lat + (e.clientY - d.py) * k, -LAT_MAX, LAT_MAX);
    d.px = e.clientX;
    d.py = e.clientY;
  };
  const onPointerUp = () => {
    if (!dragRef.current) return;
    dragRef.current = null;
    syncPanoCam(); // 交互结束写瞬态(全屏接力;循 ThreeView controls end 先例)
    schedulePersist();
  };

  // ============================ 选中态/显示选项联动 ============================
  // 选中冻结视口 → 激活(可能挤占最久未交互者,由配额回收)
  useEffect(() => {
    if (active && quotaState === "frozen") touchViewport(cellId);
  }, [active, quotaState, cellId, touchViewport]);

  // 曝光 → 渲染器应用(功能条滑条)
  useEffect(() => {
    if (rendererRef.current) rendererRef.current.toneMappingExposure = exposure;
  }, [exposure, status, quotaState]);

  // ============================ 命令式控制(功能条) ============================
  useEffect(
    () =>
      registerControl(cellId, {
        kind: "image",
        panoReset: () => {
          tgtRef.current = { ...HOME };
          schedulePersist();
        },
        togglePanoAutoRotate: () => {
          const cur = useCellViewStore.getState().views[cellId]?.panoAutoRotate ?? false;
          setView(cellId, { panoAutoRotate: !cur });
          schedulePersist();
        },
        setPanoExposure: (v: number) => {
          setView(cellId, { panoExposure: v });
          schedulePersist();
        },
      }),
    [cellId, setView, schedulePersist]
  );

  // ============================ 渲染 ============================
  const frozen = quotaState === "frozen";
  return (
    <div
      ref={containerRef}
      className="relative h-full w-full overflow-hidden bg-panel-2/40"
      style={{ cursor: active && !frozen ? (dragRef.current ? "grabbing" : "grab") : "default" }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      {status === "loading" && !frozen && (
        <div className="flex h-full w-full items-center justify-center text-xs text-text-dim">
          解析中…
        </div>
      )}
      {/* 配额降级:显示最后渲染帧截图(不占 WebGL 上下文);点击=激活本格 */}
      {frozen && (
        <button
          className="absolute inset-0 flex h-full w-full items-center justify-center"
          title="已暂停以节省资源 · 点击激活"
          onClick={() => touchViewport(cellId)}
        >
          {snapshot ? (
            <img src={snapshot} alt={file.name} className="h-full w-full object-contain" draggable={false} />
          ) : (
            <span className="text-xs text-text-dim">已暂停 · 点击激活</span>
          )}
        </button>
      )}
    </div>
  );
}
