import type { FormatHandler } from "../types";
import { XlsxView } from "../../components/preview/XlsxView";

// 电子表格(xlsx 等,§第二批新增;字节经 asset:// fetch 由 SheetJS 解析)。
export const spreadsheetHandler: FormatHandler = {
  name: "spreadsheet",
  exts: ["xlsx", "xls", "xlsm", "ods"],
  canHandle: (f) => f.kind === "spreadsheet",
  resolve: () => ({ kind: "spreadsheet", strategy: "native", component: XlsxView }),
};
