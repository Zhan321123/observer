import * as THREE from "three";
import { loadThreeModel, type LoadedModel } from "./threeLoader";
import type { FileRef } from "../types/file";

/**
 * 3D 模型按路径缓存(§修改点4):全屏/全窗切换会重挂载预览实例,若不缓存则每次都重新
 * 拉取+解析模型(大模型明显卡顿)。这里把已解析的模型(几何/材质/贴图)按路径缓存,
 * 重挂载时直接复用、秒开。LRU 上限 MAX_CACHED,在用(users>0)的一律不释放,内存可控。
 *
 * 同一 Object3D 不能同时挂在两个 scene 下,故同一文件开在多格(users>0 时再 acquire)
 * 会现解析一个独立副本(owned=true,不入缓存,由调用方卸载时自行 dispose)。
 */

const MAX_CACHED = 4;

interface Entry {
  model: LoadedModel;
  /** 正在使用该模型的存活视口数(0=空闲,可被驱逐) */
  users: number;
}

const cache = new Map<string, Entry>();

/** 释放模型的 GPU/CPU 资源(几何 / 材质 / 贴图)。逻辑与 ThreeView 原卸载释放一致,抽出复用。 */
export function disposeThreeObject(object: THREE.Object3D): void {
  object.traverse((o) => {
    const mesh = o as THREE.Mesh;
    mesh.geometry?.dispose?.();
    const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
    const disposeMat = (m?: THREE.Material) => {
      if (!m) return;
      for (const key of Object.keys(m)) {
        const val = (m as unknown as Record<string, unknown>)[key];
        if (val && (val as THREE.Texture).isTexture) (val as THREE.Texture).dispose();
      }
      m.dispose();
    };
    if (Array.isArray(mat)) mat.forEach(disposeMat);
    else disposeMat(mat);
  });
}

/** 超出上限时驱逐最旧且空闲的条目(在用的一律保留,允许暂超上限)。 */
function evict(): void {
  while (cache.size > MAX_CACHED) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey === undefined) break;
    const e = cache.get(oldestKey);
    if (!e || e.users > 0) break; // 最旧的仍在用:不再驱逐
    disposeThreeObject(e.model.object);
    cache.delete(oldestKey);
  }
}

export interface AcquiredModel {
  model: LoadedModel;
  /** true=独立副本(同文件多格并发),调用方卸载时须自行 disposeThreeObject;
   *  false=缓存持有,调用方卸载时仅需 releaseThreeModel。 */
  owned: boolean;
}

/** 获取已解析模型(命中缓存则复用,否则现解析)。 */
export async function acquireThreeModel(file: FileRef): Promise<AcquiredModel> {
  const hit = cache.get(file.path);
  if (hit && hit.users === 0) {
    cache.delete(file.path); // LRU 触碰:挪到最新
    cache.set(file.path, hit);
    hit.users = 1;
    return { model: hit.model, owned: false };
  }
  const model = await loadThreeModel(file);
  if (hit) {
    // 同文件已在其他视口使用:此副本独立,不入缓存
    return { model, owned: true };
  }
  cache.set(file.path, { model, users: 1 });
  evict();
  return { model, owned: false };
}

/** 释放缓存持有的模型(对应 owned=false 的 acquire)。 */
export function releaseThreeModel(path: string): void {
  const e = cache.get(path);
  if (e) e.users = Math.max(0, e.users - 1);
}
