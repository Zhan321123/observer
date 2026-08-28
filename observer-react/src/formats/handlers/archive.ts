import type { FormatHandler } from "../types";
import { ArchiveView } from "../../components/preview/ArchiveView";
import { PlaceholderView } from "../../components/preview/PlaceholderView";
import { isSplitFirstVolume } from "../../lib/archiveVol";

// task2 压缩包目录预览:zip / RAR4+RAR5 / 7z,以及双身份 zip 容器(jar/epub/docx/pptx
// —— 无原生预览,默认即压缩包目录)。xlsx/xlsm/ods 保持 spreadsheet 路由,
// "压缩包目录"由功能条按 xlsxMode 附加切换,不在本 handler。
// 注:条目数据由后端 archive_list 只读中央目录/头返回(铁律 2:不解压、字节不走 IPC)。
export const archiveHandler: FormatHandler = {
  name: "archive",
  exts: ["zip", "rar", "7z", "jar", "epub", "docx", "pptx"],
  canHandle: (f) => f.kind === "archive",
  resolve: (f) => {
    // 分卷首卷(§6 整体暂缓):可识别但提示暂不支持;尾卷已被文件树过滤/此处兜底
    if (isSplitFirstVolume(f.name)) {
      return {
        kind: "archive",
        strategy: "unsupported",
        component: PlaceholderView,
        reason: "分卷压缩暂不支持(请先合并各卷再预览)",
      };
    }
    return { kind: "archive", strategy: "native", component: ArchiveView };
  },
};
