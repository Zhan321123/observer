import type { FormatHandler } from "../types";
import { PdfView } from "../../components/preview/PdfView";

// PDF(§第三批新增;字节经 asset:// fetch 由 pdf.js 渲染,WebView2 自带查看器对自定义协议不可靠)。
export const pdfHandler: FormatHandler = {
  name: "pdf",
  exts: ["pdf"],
  canHandle: (f) => f.kind === "pdf",
  resolve: () => ({ kind: "pdf", strategy: "native", component: PdfView }),
};
