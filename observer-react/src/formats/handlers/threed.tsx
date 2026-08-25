import { lazy, Suspense } from "react";
import type { FormatHandler, PreviewProps } from "../types";

// three 全量(含各 loader)体积大,故经 React.lazy 动态 import 做代码分割(同 pdfjs 的做法),
// 主包不含 three;首次打开 3D 文件才加载该 chunk。
const ThreeViewLazy = lazy(() =>
  import("../../components/preview/ThreeView").then((m) => ({ default: m.ThreeView }))
);

/** 懒加载入口:自带 Suspense 边界(GridCell/FullViewOverlay 直接渲染,无需外层 Suspense) */
export function ThreeViewEntry(props: PreviewProps) {
  return (
    <Suspense
      fallback={
        <div className="flex h-full w-full items-center justify-center text-xs text-text-dim">
          加载中…
        </div>
      }
    >
      <ThreeViewLazy {...props} />
    </Suspense>
  );
}

// 3D 模型(M4):three.js loaders 渲染(gltf/glb/obj/fbx/stl/ply/dae/3ds/3mf/pcd/bvh/vox),
// 滚轮缩放 + 拖动旋转,视角持久化(threed_camera),激活视口配额降级为截图。
const THREE_EXTS = [
  "gltf", "glb", "obj", "fbx", "stl", "ply", "dae", "3ds", "3mf", "pcd", "bvh", "vox",
];

export const threedHandler: FormatHandler = {
  name: "threed",
  exts: THREE_EXTS,
  canHandle: (f) => f.kind === "threed",
  resolve: () => ({ kind: "threed", strategy: "native", component: ThreeViewEntry }),
};
