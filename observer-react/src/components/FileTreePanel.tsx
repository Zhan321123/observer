import { Breadcrumb } from "./Breadcrumb";
import { FileTree } from "./FileTree";
import { OpenedFilesList } from "./OpenedFilesList";

/**
 * 文件 frame(左):面包屑 + 文件树 + 打开的文件列表。
 * 初始文件夹由 lib/persistence.ts 的 bootstrap() 负责(还原持久化值或默认桌面)。
 */
export function FileTreePanel() {
  return (
    <div data-file-panel className="flex h-full flex-col bg-panel">
      <Breadcrumb />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <FileTree />
      </div>
      <OpenedFilesList />
    </div>
  );
}
