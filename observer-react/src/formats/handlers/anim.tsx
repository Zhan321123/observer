import { lazy, Suspense } from "react";
import type { FormatHandler, PreviewProps } from "../types";

// dotLottie/Rive 的播放器带 WASM,体积大,经 React.lazy 动态 import 代码分割(同 3D/pdfjs)。
const AnimViewLazy = lazy(() =>
  import("../../components/preview/AnimView").then((m) => ({ default: m.AnimView }))
);

/** 懒加载入口:自带 Suspense 边界 */
export function AnimViewEntry(props: PreviewProps) {
  return (
    <Suspense
      fallback={
        <div className="flex h-full w-full items-center justify-center text-xs text-text-dim">
          加载中…
        </div>
      }
    >
      <AnimViewLazy {...props} />
    </Suspense>
  );
}

// 动效(M4):dotLottie(.lottie)/ Rive(.riv)/ SVGA(.svga)。点击(选中时)= 播放/暂停,循环播放。
// 注:Lottie 的 .json 仍走 text 嗅探(sniffed="lottie" → lottie-web),不在此 handler。
export const animHandler: FormatHandler = {
  name: "anim",
  exts: ["lottie", "riv", "svga"],
  canHandle: (f) => f.kind === "anim",
  resolve: () => ({ kind: "anim", strategy: "native", component: AnimViewEntry }),
};
