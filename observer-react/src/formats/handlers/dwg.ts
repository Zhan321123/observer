import type { FormatHandler } from "../types";
import { PlaceholderView } from "../../components/preview/PlaceholderView";

// DWG(AutoCAD 原生闭源二进制格式):无许可干净的开源解析器——
// LibreDWG 为 GPL 的 C 库(随包编译有许可/构建风险),ODA File Converter 需外部安装,
// 云端转换(Autodesk Platform Services)违背离线原则。故本轮只识别不渲染:
// 给出明确占位说明,引导用户导出 DXF(同管道可预览)。
// kind 走独立的 "dwg"(Rust kind_for_ext 同步返回),与 threed 的 dxf 区分。
export const dwgHandler: FormatHandler = {
  name: "dwg",
  exts: ["dwg"],
  canHandle: (f) => f.ext === "dwg" || f.kind === "dwg" || f.sniffed === "dwg",
  resolve: () => ({
    kind: "dwg",
    strategy: "unsupported",
    component: PlaceholderView,
    reason: "DWG 为 AutoCAD 闭源格式,暂不支持预览;可在 CAD 中另存为 DXF 后打开",
  }),
};
