// 3D 模型加载(method.md §6):扩展名 → three.js loader 分发,统一归一化为
// { object, animations, info }。字节经 asset:// fetch(铁律 2);外部资源(gltf 的 .bin/贴图、
// obj 的 .mtl/贴图、dae 贴图)经 LoadingManager URL 改写解析为同目录 asset:// 文件。
// three 全量(含各 loader)体积大,本模块由 ThreeView 动态 import 做代码分割,不拖累主包。

import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
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
}

export interface LoadedModel {
  object: THREE.Object3D;
  animations: THREE.AnimationClip[];
  info: ThreeModelInfo;
}

/** 本 handler 认识的 3D 扩展名(与 formats.rs kind_for_ext、registry 对齐) */
export const THREE_EXTS = [
  "gltf", "glb", "obj", "fbx", "stl", "ply", "dae", "3ds", "3mf", "pcd", "bvh", "vox",
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

/** 统计顶点/面数/材质数/包围盒(动画数在外层补) */
function computeInfo(object: THREE.Object3D, animations: number): ThreeModelInfo {
  let vertices = 0;
  let triangles = 0;
  const mats = new Set<THREE.Material>();
  object.traverse((o) => {
    const mesh = o as THREE.Mesh;
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
    if (Array.isArray(m)) m.forEach((x) => x && mats.add(x));
    else if (m) mats.add(m);
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
      const gltf = await new GLTFLoader(manager).parseAsync(buf, "");
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
    default:
      throw new Error(`暂不支持的 3D 格式:.${ext}`);
  }

  if (!object) throw new Error("模型解析为空");
  const info = computeInfo(object, animations.length);
  return { object, animations, info };
}
