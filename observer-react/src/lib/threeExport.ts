// M5 3D 导出(three.js exporters,method.md §8):按目标格式分发到 GLTF/STL/OBJ/PLY 导出器。
// three 体积大,与 threeLoader 同策略:本模块只 `import type` 引类型(编译期擦除),
// exporter 一律分支内动态 import——ConvertPanel(主包)不因此拖入 three;
// 能导出时 three 必已由 ThreeView 加载,动态 import 是缓存命中。

import type * as THREE from "three";

export type ThreedTargetFormat = "glb" | "gltf" | "stl" | "obj" | "ply";

/** 导出为字节(glb/stl/ply 二进制;gltf/obj 文本 → UTF-8),供 base64 → convert_write 落盘。 */
export async function exportThreed(
  object: THREE.Object3D,
  animations: THREE.AnimationClip[],
  format: ThreedTargetFormat,
): Promise<Uint8Array> {
  switch (format) {
    case "glb":
    case "gltf": {
      const { GLTFExporter } = await import("three/examples/jsm/exporters/GLTFExporter.js");
      // 贴图恒内嵌(glb→bufferViews,gltf→data URI);onlyVisible:false 防隐藏节点被裁
      const out = await new GLTFExporter().parseAsync(object, {
        binary: format === "glb",
        onlyVisible: false,
        animations,
      });
      if (typeof out === "string") return new TextEncoder().encode(out);
      if (!(out instanceof ArrayBuffer)) throw new Error("glTF 导出结果为空");
      return new Uint8Array(out);
    }
    case "stl": {
      const { STLExporter } = await import("three/examples/jsm/exporters/STLExporter.js");
      // 二进制 STL 重载直接返回 DataView,按字节偏移还原为整段 Uint8Array
      const dv = new STLExporter().parse(object, { binary: true });
      return new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength);
    }
    case "obj": {
      const { OBJExporter } = await import("three/examples/jsm/exporters/OBJExporter.js");
      // OBJExporter 仅导几何(不产出 MTL)——有贴图源的丢失提醒由此而来
      return new TextEncoder().encode(new OBJExporter().parse(object));
    }
    case "ply": {
      const { PLYExporter } = await import("three/examples/jsm/exporters/PLYExporter.js");
      // onDone 为必传形参(内部经 rAF 回调);此处取同步返回值
      const out = new PLYExporter().parse(object, () => {}, { binary: true });
      if (!out) throw new Error("PLY 导出结果为空");
      return new Uint8Array(out);
    }
  }
}
