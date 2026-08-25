import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { acquireThreeModel, releaseThreeModel, disposeThreeObject } from "../../lib/threeModelCache";
import { threedGet, threedSet } from "../../lib/persist";
import { useCellViewStore } from "../../stores/cellViewStore";
import { useThreeDStore, registerThreeEngine } from "../../stores/threeDStore";
import { registerControl } from "../../stores/cellControls";
import type { PreviewProps } from "../../formats/types";

/** 视角/显示选项持久化 JSON(threed_camera.camera) */
interface PersistedView {
  p: [number, number, number];
  t: [number, number, number];
  grid?: boolean;
  wire?: boolean;
  spin?: boolean;
  light?: number;
}

/** 光照环境预设(cycleThreedLight 循环;无阴影保性能) */
const LIGHT_PRESETS = ["studio", "soft", "bright"] as const;

/**
 * 3D 预览(M4,method.md §6 / layout.md §4.5·§5)。
 * - three.js loaders 覆盖 gltf/glb/obj/fbx/stl/ply/dae/3ds/3mf/pcd/bvh/vox(lib/threeLoader 归一化)。
 * - 交互:滚轮缩放(推近/拉远)+ 拖动旋转(OrbitControls,active 时才 enabled),不设快捷键。
 * - 视角持久化:交互停止 500ms 防抖 + 卸载时经 threed_camera 落盘;重开恢复。
 *   全屏切换经 cellViewStore.threedCam 瞬态接力(同步读取,无 IPC 竞态),重启才走 SQLite。
 * - 功能条:重置视角 / 自动旋转 / 线框 / 平面网格 / 光照环境切换。
 * - 资源配额(layout.md §4.7):激活视口数 ≤ threeDQuota,超出降级为"最后渲染帧"截图并释放
 *   WebGL 上下文;选中/点击截图激活,最久未交互者被降级(见 stores/threeDStore + useThreeDQuota)。
 */
export function ThreeView({ file, cellId, active }: PreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const setView = useCellViewStore((s) => s.setView);
  const setFullView = useCellViewStore((s) => s.setFullView);
  const setFullScreen = useCellViewStore((s) => s.setFullScreen);

  // 配额视口态(响应式):active=实时渲染 / frozen=截图
  const quotaState = useThreeDStore((s) => s.viewports[cellId]?.state ?? "active");
  const snapshot = useThreeDStore((s) => s.viewports[cellId]?.snapshot ?? null);
  const touchViewport = useThreeDStore((s) => s.touch);
  const registerViewport = useThreeDStore((s) => s.register);
  const unregisterViewport = useThreeDStore((s) => s.unregister);

  // 显示选项(响应式,功能条 active 态 + 视图应用)
  const showGrid = useCellViewStore((s) => s.views[cellId]?.threedGrid) ?? true;
  const wireframe = useCellViewStore((s) => s.views[cellId]?.threedWireframe) ?? false;
  const autoRotate = useCellViewStore((s) => s.views[cellId]?.threedAutoRotate) ?? false;
  const lightIdx = useCellViewStore((s) => s.views[cellId]?.threedLight) ?? 0;

  const [status, setStatus] = useState<"loading" | "ready">("loading");

  // ---- three 对象(CPU 侧常驻:跨 freeze/activate 存活;GPU 侧 renderer/controls 随配额重建) ----
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const modelRef = useRef<THREE.Object3D | null>(null);
  const gridRef = useRef<THREE.GridHelper | null>(null);
  const lightsRef = useRef<THREE.Group | null>(null);
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);
  const targetRef = useRef(new THREE.Vector3());
  const homeRef = useRef<{ p: THREE.Vector3; t: THREE.Vector3 } | null>(null);
  // ---- 每激活期对象(GPU) ----
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const rafRef = useRef(0);
  const clockRef = useRef(new THREE.Clock());

  const readyRef = useRef(false); // 模型已加载、相机已就位
  const dirtyRef = useRef(false); // 用户已交互/改选项 → 需持久化
  // 本次挂载的模型归属(§修改点4):"cache"=缓存持有(卸载归还引用)/ "owned"=独立副本
  // (同文件多格,卸载自行 dispose)/ null=尚未 acquire 完(卸载时不碰模型,由异步分支善后)。
  // 用三态而非布尔,避免"解析期间被卸载"时误判归属、误减他格在用模型的引用计数。
  const acquiredRef = useRef<"cache" | "owned" | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeRef = useRef(active);
  activeRef.current = active;

  /** 当前视角 + 显示选项 → threed_camera(仅 dirty 时;防抖/卸载调用) */
  const persistView = useCallback(() => {
    if (!readyRef.current || !dirtyRef.current) return;
    const cam = cameraRef.current;
    if (!cam) return;
    const v = useCellViewStore.getState().views[cellId];
    const payload: PersistedView = {
      p: [cam.position.x, cam.position.y, cam.position.z],
      t: [targetRef.current.x, targetRef.current.y, targetRef.current.z],
      grid: v?.threedGrid ?? true,
      wire: v?.threedWireframe ?? false,
      spin: v?.threedAutoRotate ?? false,
      light: v?.threedLight ?? 0,
    };
    void threedSet(file.path, JSON.stringify(payload)).catch(() => {});
  }, [cellId, file.path]);

  const schedulePersist = useCallback(() => {
    dirtyRef.current = true;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(persistView, 500);
  }, [persistView]);

  /** 当前相机/目标写入 cellViewStore.threedCam(全屏切换瞬态接力)。
   *  只在交互结束/卸载时调(自动旋转时若逐帧 setView 会让功能条/信息框 60fps 重渲染)。
   *  带 file.path 标签:宫内替换文件时,旧相机的瞬态不被新模型误用(§修改点1)。 */
  const syncThreedCam = useCallback(() => {
    const cam = cameraRef.current;
    if (!cam) return;
    setView(cellId, {
      threedCam: {
        path: file.path,
        p: [cam.position.x, cam.position.y, cam.position.z],
        t: [targetRef.current.x, targetRef.current.y, targetRef.current.z],
      },
    });
  }, [cellId, file.path, setView]);

  /** 相机/目标应用到 OrbitControls(若存在)并记 targetRef */
  const applyCamera = useCallback((p: [number, number, number], t: [number, number, number]) => {
    const cam = cameraRef.current;
    if (!cam) return;
    cam.position.set(p[0], p[1], p[2]);
    targetRef.current.set(t[0], t[1], t[2]);
    if (controlsRef.current) {
      controlsRef.current.target.copy(targetRef.current);
      controlsRef.current.update();
    }
  }, []);

  /** 自适应取景:按模型包围盒摆放相机(记录为"重置视角"的归位) */
  const frameModel = useCallback(() => {
    const cam = cameraRef.current;
    const model = modelRef.current;
    if (!cam || !model) return;
    const box = new THREE.Box3().setFromObject(model);
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    const fov = (cam.fov * Math.PI) / 180;
    const dist = (maxDim / (2 * Math.tan(fov / 2))) * 1.5;
    const dir = new THREE.Vector3(1, 0.65, 1).normalize();
    cam.position.copy(center).addScaledVector(dir, dist);
    cam.near = Math.max(dist / 1000, 0.001);
    cam.far = dist * 1000;
    cam.updateProjectionMatrix();
    targetRef.current.copy(center);
    homeRef.current = { p: cam.position.clone(), t: center.clone() };
    if (controlsRef.current) {
      controlsRef.current.target.copy(center);
      controlsRef.current.update();
    }
  }, []);

  /** 光照环境:按预设重建灯组(挂在 scene 的 lightsGroup 上) */
  const applyLighting = useCallback((idx: number) => {
    const lights = lightsRef.current;
    if (!lights) return;
    while (lights.children.length) lights.remove(lights.children[0]);
    const preset = LIGHT_PRESETS[idx % LIGHT_PRESETS.length];
    if (preset === "studio") {
      lights.add(new THREE.HemisphereLight(0xffffff, 0x3a4552, 1.0));
      const key = new THREE.DirectionalLight(0xffffff, 1.4);
      key.position.set(3, 5, 4);
      const fill = new THREE.DirectionalLight(0xdfe8ff, 0.5);
      fill.position.set(-4, 2, -3);
      lights.add(key, fill);
    } else if (preset === "soft") {
      lights.add(new THREE.AmbientLight(0xffffff, 0.7));
      const dir = new THREE.DirectionalLight(0xffffff, 0.8);
      dir.position.set(2, 4, 3);
      lights.add(dir);
    } else {
      lights.add(new THREE.AmbientLight(0xffffff, 1.0));
      const dir = new THREE.DirectionalLight(0xffffff, 1.1);
      dir.position.set(1, 2, 3);
      lights.add(dir);
    }
  }, []);

  /** 线框模式:遍历模型所有 mesh 材质切换 wireframe(数组材质逐个;无该属性的跳过) */
  const applyWireframe = useCallback((on: boolean) => {
    modelRef.current?.traverse((o) => {
      const mat = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      const each = (m?: THREE.Material) => {
        if (m && "wireframe" in m) (m as THREE.MeshStandardMaterial).wireframe = on;
      };
      if (Array.isArray(mat)) mat.forEach(each);
      else each(mat);
    });
  }, []);

  // ---- 卸载工具:释放 GPU 资源 ----
  const disposeRenderer = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    controlsRef.current?.dispose();
    controlsRef.current = null;
    const r = rendererRef.current;
    if (r) {
      r.dispose();
      r.forceContextLoss();
      r.domElement.remove();
      rendererRef.current = null;
    }
  }, []);

  // ============================ 加载与场景构建(file/cell 变化时重来) ============================
  useEffect(() => {
    let cancelled = false;
    registerViewport(cellId);
    setStatus("loading");
    readyRef.current = false;
    dirtyRef.current = false;
    acquiredRef.current = null; // 本效应周期重新归属(防同一实例重跑时沿用上次归属而重复释放)

    // 场景骨架(常驻,跨 freeze 存活)
    const scene = new THREE.Scene();
    sceneRef.current = scene;
    const camera = new THREE.PerspectiveCamera(50, 1, 0.01, 10000);
    camera.position.set(3, 2, 5);
    cameraRef.current = camera;
    const lights = new THREE.Group();
    scene.add(lights);
    lightsRef.current = lights;

    (async () => {
      try {
        // 按路径缓存的模型(§修改点4):全屏/重挂载复用已解析模型,秒开不重新拉取+解析
        const { model, owned } = await acquireThreeModel(file);
        if (cancelled) {
          // 解析期间被卸载(acquiredRef 仍 null,清理函数未碰模型):此处善后,避免泄漏
          if (owned) disposeThreeObject(model.object);
          else releaseThreeModel(file.path);
          return;
        }
        acquiredRef.current = owned ? "owned" : "cache";
        const { object, animations, info } = model;
        modelRef.current = object;
        scene.add(object);

        // 平面网格:按模型包围盒铺在模型底部(默认显示,§功能条"平面网格"开关)
        const box = new THREE.Box3().setFromObject(object);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());
        const span = Math.max(size.x, size.z, size.y, 1);
        const grid = new THREE.GridHelper(span * 2, 20, 0x4ea3e0, 0x2a3441);
        grid.position.set(center.x, box.min.y, center.z);
        const gridMat = grid.material as THREE.Material;
        gridMat.transparent = true;
        gridMat.opacity = 0.5;
        scene.add(grid);
        gridRef.current = grid;

        // 动画:有则循环播放第一段
        if (animations.length) {
          const mixer = new THREE.AnimationMixer(object);
          mixer.clipAction(animations[0]).play();
          mixerRef.current = mixer;
        }

        // 取景 + 视角/显示选项恢复(① 瞬态 threedCam(须属本文件)→ ② threed_camera → ③ 默认自适应)
        frameModel();
        const v = useCellViewStore.getState().views[cellId];
        if (v?.threedCam && v.threedCam.path === file.path) {
          applyCamera(v.threedCam.p, v.threedCam.t);
        } else {
          const raw = await threedGet(file.path).catch(() => null);
          if (cancelled) return;
          if (raw) {
            try {
              const j = JSON.parse(raw) as PersistedView;
              if (Array.isArray(j.p) && Array.isArray(j.t)) applyCamera(j.p, j.t);
              setView(cellId, {
                threedGrid: j.grid ?? true,
                threedWireframe: j.wire ?? false,
                threedAutoRotate: j.spin ?? false,
                threedLight: j.light ?? 0,
              });
            } catch {
              // 视角 JSON 损坏 → 用默认
            }
          }
        }

        // 显示选项初值(若上面未从持久化写入,则为默认):套用到场景
        const cur = useCellViewStore.getState().views[cellId];
        applyLighting(cur?.threedLight ?? 0);
        applyWireframe(cur?.threedWireframe ?? false);
        if (gridRef.current) gridRef.current.visible = cur?.threedGrid ?? true;

        readyRef.current = true;
        setStatus("ready");
        setView(cellId, { threedInfo: info });
      } catch (e) {
        if (!cancelled) setView(cellId, { error: e instanceof Error ? e.message : "3D 模型解析失败" });
      }
    })();

    return () => {
      cancelled = true;
      // 卸载:先接力相机(供全屏实例恢复)→ flush 持久化 → 释放资源 → 注销视口
      syncThreedCam();
      if (saveTimer.current) clearTimeout(saveTimer.current);
      persistView();
      disposeRenderer();
      // 模型资源(§修改点4):独立副本(owned)自行释放;缓存持有的仅归还引用,
      // 留给全屏/重挂载复用,避免重复解析。null=解析期间即卸载,模型由异步分支善后,此处不碰。
      if (acquiredRef.current === "owned" && modelRef.current) {
        disposeThreeObject(modelRef.current);
      } else if (acquiredRef.current === "cache") {
        releaseThreeModel(file.path);
      }
      mixerRef.current = null;
      modelRef.current = null;
      gridRef.current = null;
      sceneRef.current = null;
      cameraRef.current = null;
      unregisterViewport(cellId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file.path, cellId]);

  // ============================ GPU 渲染期(随配额 state 重建/释放) ============================
  useEffect(() => {
    if (status !== "ready" || quotaState !== "active") return;
    const container = containerRef.current;
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    if (!container || !scene || !camera) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      setView(cellId, { error: "无法创建 WebGL 上下文(可能已达上限)" });
      return;
    }
    renderer.setPixelRatio(window.devicePixelRatio || 1);
    renderer.setSize(container.clientWidth, container.clientHeight);
    camera.aspect = container.clientWidth / Math.max(1, container.clientHeight);
    camera.updateProjectionMatrix();
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.12;
    controls.target.copy(targetRef.current);
    controls.enabled = activeRef.current;
    controls.autoRotate = useCellViewStore.getState().views[cellId]?.threedAutoRotate ?? false;
    controls.update();
    controlsRef.current = controls;

    controls.addEventListener("start", () => touchViewport(cellId));
    controls.addEventListener("change", () => {
      // 只同步目标点(廉价,不 setView);threedCam 在 end/卸载时统一写,避免自动旋转逐帧重渲染
      targetRef.current.copy(controls.target);
    });
    controls.addEventListener("end", () => {
      syncThreedCam();
      schedulePersist();
    });

    clockRef.current.getDelta(); // 重置时钟,避免首帧 dt 过大
    const loop = () => {
      rafRef.current = requestAnimationFrame(loop);
      const dt = clockRef.current.getDelta();
      controls.update();
      mixerRef.current?.update(dt);
      renderer.render(scene, camera);
    };
    loop();

    // 容器尺寸变化 → 调整渲染尺寸/相机纵横比
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
      disposeRenderer();
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

  // ============================ 选中态/显示选项联动 ============================
  // 选中冻结视口 → 激活(可能挤占最久未交互者,由配额回收)
  useEffect(() => {
    if (active && quotaState === "frozen") touchViewport(cellId);
  }, [active, quotaState, cellId, touchViewport]);

  // active 变化 → OrbitControls.enabled
  useEffect(() => {
    if (controlsRef.current) controlsRef.current.enabled = active;
  }, [active, quotaState]);

  // 平面网格开关 → 网格可见性(用户核心诉求)
  useEffect(() => {
    if (gridRef.current) gridRef.current.visible = showGrid;
  }, [showGrid, status]);

  // 线框 / 自动旋转 / 光照 → 场景应用
  useEffect(() => {
    applyWireframe(wireframe);
  }, [wireframe, status, applyWireframe]);
  useEffect(() => {
    if (controlsRef.current) controlsRef.current.autoRotate = autoRotate;
  }, [autoRotate, quotaState]);
  useEffect(() => {
    applyLighting(lightIdx);
  }, [lightIdx, status, applyLighting]);

  // ============================ 命令式控制(功能条) ============================
  useEffect(
    () =>
      registerControl(cellId, {
        kind: "threed",
        threedReset: () => {
          if (homeRef.current) {
            applyCamera(
              [homeRef.current.p.x, homeRef.current.p.y, homeRef.current.p.z],
              [homeRef.current.t.x, homeRef.current.t.y, homeRef.current.t.z]
            );
          } else {
            frameModel();
          }
          schedulePersist();
        },
        toggleThreedAutoRotate: () => {
          const cur = useCellViewStore.getState().views[cellId]?.threedAutoRotate ?? false;
          setView(cellId, { threedAutoRotate: !cur });
          schedulePersist();
        },
        toggleThreedWireframe: () => {
          const cur = useCellViewStore.getState().views[cellId]?.threedWireframe ?? false;
          setView(cellId, { threedWireframe: !cur });
          schedulePersist();
        },
        toggleThreedGrid: () => {
          const cur = useCellViewStore.getState().views[cellId]?.threedGrid ?? true;
          setView(cellId, { threedGrid: !cur });
          schedulePersist();
        },
        cycleThreedLight: () => {
          const cur = useCellViewStore.getState().views[cellId]?.threedLight ?? 0;
          setView(cellId, { threedLight: (cur + 1) % LIGHT_PRESETS.length });
          schedulePersist();
        },
        enterFullView: () => setFullView(cellId),
        enterFullScreen: () => {
          setFullView(cellId);
          setFullScreen(true);
        },
      }),
    [cellId, applyCamera, frameModel, schedulePersist, setView, setFullView, setFullScreen]
  );

  // ============================ 渲染 ============================
  const frozen = quotaState === "frozen";
  return (
    <div ref={containerRef} className="relative h-full w-full overflow-hidden bg-panel-2/40">
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
