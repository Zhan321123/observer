import type { FormatHandler } from "../types";
import { DocumentView } from "../../components/preview/DocumentView";

// task2 二:docx/pptx(zip 容器)→ 文档渲染(docx-preview 页面流 / pptx-browser 幻灯片流)。
// 循 xlsx 双身份先例:本 handler 登记默认路由,"压缩包目录"视角由功能条 docMode 附加切换。
export const documentHandler: FormatHandler = {
  name: "document",
  exts: ["docx", "pptx"],
  canHandle: (f) => f.kind === "document",
  resolve: () => ({ kind: "document", strategy: "native", component: DocumentView }),
};
