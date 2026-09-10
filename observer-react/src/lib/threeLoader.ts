// 3D 模型加载(method.md §6):扩展名 → three.js loader 分发,统一归一化为
// { object, animations, info }。字节经 asset:// fetch(铁律 2);外部资源(gltf 的 .bin/贴图、
// obj 的 .mtl/贴图、dae 贴图)经 LoadingManager URL 改写解析为同目录 asset:// 文件。
// glb/gltf 另支持 EXT_meshopt_compression + KHR_mesh_quantization(见下方 MeshoptDecoder)。
// three 全量(含各 loader)体积大,本模块由 ThreeView 动态 import 做代码分割,不拖累主包。

import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { MTLLoader } from "three/examples/jsm/loaders/MTLLoader.js";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { PLYLoader } from "three/examples/jsm/loaders/PLYLoader.js";
import { ColladaLoader } from "three/examples/jsm/loaders/ColladaLoader.js";
import { TDSLoader } from "three/examples/jsm/loaders/TDSLoader.js";
import { ThreeMFLoader } from "three/examples/jsm/loaders/3MFLoader.js";
import { PCDLoader } from "three/examples/jsm/loaders/PCDLoader.js";
import { BVHLoader } from "three/examples/jsm/loaders/BVHLoader.js";
import { VOXLoader } from "three/examples/jsm/loaders/VOXLoader.js";
import { buildDxfObject } from "./dxfToThree";
import { decodeTextBytes } from "./decodeText";
import { assetUrl, allowAssetPath } from "./tauri";
import type { FileRef } from "../types/file";

/** 文件信息框(layout.md §6 3D):顶点/面数、材质数、动画数、包围盒尺寸 */
export interface ThreeModelInfo {
  vertices: number;
  triangles: number;
  materials: number;
  animations: number;
  /** 包围盒尺寸(世界单位) */
  bbox: [number, number, number];
  /** 场景是否含 Mesh(无则 stl/obj/ply 不可选:PCD 点云/DXF 线段/BVH 骨骼) */
  hasMesh: boolean;
  /** 材质是否带贴图(转 stl/obj/ply 会丢 → 转换前提醒) */
  hasTextures: boolean;
  /** 可爆炸零件数(分叉层含 Mesh 子树数;<2 不可用:单 mesh 的 stl/ply、点云/图纸/骨骼 → 功能条隐藏爆炸按钮) */
  parts: number;
}

export interface LoadedModel {
  object: THREE.Object3D;
  animations: THREE.AnimationClip[];
  info: ThreeModelInfo;
  /** 爆炸图零件(可爆零件 <2 时为空数组,与 info.parts 门控一致) */
  parts: ExplodePart[];
}

/** 爆炸图零件:applyExplode 做 node.position = home + offset·k(k∈[0,1])。
 *  数据在解析期采集(位置未被任何爆炸位移污染)且为绝对赋值 → 幂等,
 *  模型缓存复用 / reloadKey 重挂载时免疫上次残留,不漂移。 */
export interface ExplodePart {
  node: THREE.Object3D;
  /** 解析时的原始局部 position(clone 快照) */
  home: THREE.Vector3;
  /** k=1 的位移向量(父局部系,含尺度) */
  offset: THREE.Vector3;
}

/** 本 handler 认识的 3D 扩展名(与 formats.rs kind_for_ext、registry 对齐) */
export const THREE_EXTS = [
  "gltf", "glb", "obj", "fbx", "stl", "ply", "dae", "3ds", "3mf", "pcd", "bvh", "vox",
  "dxf", // CAD 图纸(dxfToThree 自绘,非 three loader;threed.tsx 处有同名清单)
];

/** 把模型同目录的相对资源引用(gltf .bin / 贴图、mtl 贴图)解析为绝对路径。 */
function resolveSibling(modelPath: string, ref: string): string {
  const decoded = decodeURIComponent(ref);
  // 已是绝对路径(盘符 / UNC /  posix 根)直接使用
  if (/^([A-Za-z]:[\\/]|\\\\|\/)/.test(decoded)) return decoded;
  const win = /\\/.test(modelPath) || /^[A-Za-z]:/.test(modelPath);
  const sep = win ? "\\" : "/";
  const dir = modelPath.replace(/[\\/][^\\/]*$/, "");
  const rel = decoded.replace(/^\.\//, "").split("/").join(sep);
  return dir + sep + rel;
}

/** 建立把相对资源 URL 改写为同目录 asset:// 的 LoadingManager。 */
function makeManager(modelPath: string): THREE.LoadingManager {
  const manager = new THREE.LoadingManager();
  manager.setURLModifier((url) => {
    if (/^(blob:|data:)/.test(url)) return url; // 内嵌资源
    if (/^https?:/.test(url)) return url; // 已是完整 URL
    const abs = resolveSibling(modelPath, url);
    void allowAssetPath(abs).catch(() => {});
    return assetUrl(abs);
  });
  return manager;
}

function toText(buf: ArrayBuffer): string {
  return new TextDecoder("utf-8").decode(buf);
}

/** 几何体 → Mesh(STL/PLY 等只给 BufferGeometry 的格式) */
function geometryToMesh(geo: THREE.BufferGeometry): THREE.Mesh {
  const hasColor = !!geo.getAttribute("color");
  if (!geo.getAttribute("normal")) geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({
    color: hasColor ? 0xffffff : 0x9aa4b0,
    vertexColors: hasColor,
    roughness: 0.75,
    metalness: 0.1,
    side: THREE.DoubleSide,
  });
  return new THREE.Mesh(geo, mat);
}

/** 材质贴图槽位(任一非空即视为带贴图;转 STL/OBJ/PLY 会丢) */
const TEX_SLOTS = [
  "map", "normalMap", "roughnessMap", "metalnessMap", "emissiveMap",
  "aoMap", "alphaMap", "bumpMap", "displacementMap", "specularMap", "lightMap", "envMap",
] as const;

/** 材质是否带任一贴图(槽位持有 Texture 即真) */
function hasAnyTexture(mat: THREE.Material): boolean {
  const m = mat as unknown as Record<string, unknown>;
  return TEX_SLOTS.some((slot) => {
    const v = m[slot];
    return !!v && typeof v === "object" && (v as THREE.Texture).isTexture === true;
  });
}

/** 子树是否含 Mesh(排除灯光/相机/线段/点云/BVH 骨骼等非 Mesh 对象) */
function subtreeHasMesh(node: THREE.Object3D): boolean {
  let has = false;
  node.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) has = true;
  });
  return has;
}

/**
 * 收集爆炸图零件(子树粒度,保持子装配整体性):从模型根下钻,统计 children 中
 * "子树含 Mesh"的孩子数——0=无零件;1=单链继续下钻(找到真正的分叉层);≥2=这些孩子即零件。
 * 方向=零件包围盒中心−装配中心(世界系径向,同心件跳过),尺度=装配最大边长×0.55;
 * 世界位移经父矩阵逆的线性部分(Matrix3,仿射精确)转局部系——不能用 transformDirection
 * (会归一化丢父链缩放:FBX 常带 cm 单位根 scale=0.01,位移将缩小 100 倍)。
 * 可用零件 <2 时返回 [](单件散开=整体平移,无意义;info.parts=0)。
 */
function collectExplodeParts(object: THREE.Object3D): ExplodePart[] {
  object.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(object);
  if (box.isEmpty()) return [];
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z) || 1;

  let level: THREE.Object3D = object;
  let meshKids: THREE.Object3D[] = [];
  for (;;) {
    meshKids = level.children.filter(subtreeHasMesh);
    if (meshKids.length !== 1) break;
    level = meshKids[0]; // 单链下钻:唯一含 Mesh 的孩子才是潜在的零件层
  }
  if (meshKids.length < 2) return [];

  const parts: ExplodePart[] = [];
  for (const node of meshKids) {
    const dir = new THREE.Box3().setFromObject(node).getCenter(new THREE.Vector3()).sub(center);
    if (dir.lengthSq() < 1e-12) continue; // 同心零件:方向不稳定,原地不动
    dir.normalize().multiplyScalar(maxDim * 0.55);
    const m3 = new THREE.Matrix3().setFromMatrix4(node.parent!.matrixWorld.clone().invert());
    parts.push({ node, home: node.position.clone(), offset: dir.applyMatrix3(m3) });
  }
  return parts.length >= 2 ? parts : [];
}

/** 统计顶点/面数/材质数/包围盒(动画数在外层补) */
function computeInfo(object: THREE.Object3D, animations: number, parts: number): ThreeModelInfo {
  let vertices = 0;
  let triangles = 0;
  let hasMesh = false;
  let hasTextures = false;
  const mats = new Set<THREE.Material>();
  object.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) hasMesh = true;
    const geo = mesh.geometry as THREE.BufferGeometry | undefined;
    if (geo?.getAttribute) {
      const pos = geo.getAttribute("position");
      if (pos) vertices += pos.count;
      const isPoints = (o as THREE.Points).isPoints || (o as THREE.Line).isLine;
      if (!isPoints) {
        const idx = geo.getIndex();
        triangles += Math.floor((idx ? idx.count : pos ? pos.count : 0) / 3);
      }
    }
    const m = mesh.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(m)) {
      m.forEach((x) => {
        if (!x) return;
        mats.add(x);
        if (hasAnyTexture(x)) hasTextures = true;
      });
    } else if (m) {
      mats.add(m);
      if (hasAnyTexture(m)) hasTextures = true;
    }
  });
  const box = new THREE.Box3().setFromObject(object);
  const size = new THREE.Vector3();
  if (!box.isEmpty()) box.getSize(size);
  return {
    vertices,
    triangles,
    materials: mats.size,
    animations,
    bbox: [size.x, size.y, size.z],
    hasMesh,
    hasTextures,
    parts,
  };
}

/**
 * 加载并归一化一个 3D 模型。失败抛错(由调用方转为宫格错误占位)。
 */
export async function loadThreeModel(file: FileRef): Promise<LoadedModel> {
  await allowAssetPath(file.path).catch(() => {});
  const resp = await fetch(assetUrl(file.path));
  if (!resp.ok) throw new Error(`读取文件失败(${resp.status})`);
  const buf = await resp.arrayBuffer();
  const manager = makeManager(file.path);
  const ext = file.ext.toLowerCase();

  let object: THREE.Object3D;
  let animations: THREE.AnimationClip[] = [];

  switch (ext) {
    case "gltf":
    case "glb": {
      // EXT_meshopt_compression(网站常用的 meshopt 压缩 GLB,如 Tripo)需挂 MeshoptDecoder
      // (WASM 解码,WebView2 支持);KHR_mesh_quantization GLTFLoader 原生支持,无需处理。
      const loader = new GLTFLoader(manager);
      loader.setMeshoptDecoder(MeshoptDecoder);
      const gltf = await loader.parseAsync(buf, "");
      object = gltf.scene || gltf.scenes?.[0];
      animations = gltf.animations ?? [];
      break;
    }
    case "obj": {
      const loader = new OBJLoader(manager);
      // 尝试同名 .mtl(贴图经 manager 解析);失败则用默认材质
      const mtlPath = file.path.replace(/\.[^.\\/]+$/, "") + ".mtl";
      try {
        await allowAssetPath(mtlPath).catch(() => {});
        const r = await fetch(assetUrl(mtlPath));
        if (r.ok) {
          const mtl = new MTLLoader(manager).parse(toText(await r.arrayBuffer()), "");
          mtl.preload();
          loader.setMaterials(mtl);
        }
      } catch {
        // 无 mtl 或读取失败 → 默认材质
      }
      object = loader.parse(toText(buf));
      break;
    }
    case "fbx": {
      const group = new FBXLoader(manager).parse(buf, "");
      object = group;
      animations = group.animations ?? [];
      break;
    }
    case "stl":
      object = geometryToMesh(new STLLoader().parse(buf));
      break;
    case "ply":
      object = geometryToMesh(new PLYLoader().parse(buf));
      break;
    case "dae": {
      const collada = new ColladaLoader(manager).parse(toText(buf), "");
      if (!collada?.scene) throw new Error("DAE 解析为空");
      object = collada.scene;
      animations = (collada as unknown as { animations?: THREE.AnimationClip[] }).animations ?? [];
      break;
    }
    case "3ds":
      object = new TDSLoader(manager).parse(buf, "");
      break;
    case "3mf":
      object = new ThreeMFLoader(manager).parse(buf);
      break;
    case "pcd":
      object = new PCDLoader().parse(buf);
      break;
    case "bvh": {
      // BVH 是动作捕捉:骨骼 + 单段动画,用 SkeletonHelper 可视化并播放
      const bvh = new BVHLoader().parse(toText(buf));
      const boneContainer = new THREE.Group();
      boneContainer.add(bvh.skeleton.bones[0]);
      const helper = new THREE.SkeletonHelper(bvh.skeleton.bones[0]);
      const group = new THREE.Group();
      group.add(boneContainer);
      group.add(helper);
      object = group;
      animations = [bvh.clip];
      break;
    }
    case "vox": {
      const result = new VOXLoader(manager).parse(buf);
      object = result.scene;
      break;
    }
    case "dxf": {
      // DXF(CAD 图纸):文本格式,可能为 GBK 中文注释 → 复用编码探测;
      // dxf-parser 同步解析,大文件会卡主线程(见 dxfToThree TODO)
      object = buildDxfObject(decodeTextBytes(buf)).object;
      break;
    }
    default:
      throw new Error(`暂不支持的 3D 格式:.${ext}`);
  }

  if (!object) throw new Error("模型解析为空");
  const parts = collectExplodeParts(object);
  const info = computeInfo(object, animations.length, parts.length);
  return { object, animations, info, parts };
}
