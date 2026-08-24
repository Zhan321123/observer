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
      {/* FileTree 自带滚动容器(虚拟滚动);此处仅撑满高度 */}
      <div className="min-h-0 flex-1">
        <FileTree />
      </div>
      <OpenedFilesList />
    </div>
  );
}
