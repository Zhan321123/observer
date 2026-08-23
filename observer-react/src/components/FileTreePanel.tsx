import { useEffect } from "react";
import { Breadcrumb } from "./Breadcrumb";
import { FileTree } from "./FileTree";
import { OpenedFilesList } from "./OpenedFilesList";
import { useFolderStore } from "../stores/folderStore";

/** 文件 frame(左):面包屑 + 文件树 + 打开的文件列表。 */
export function FileTreePanel() {
  const init = useFolderStore((s) => s.init);
  const rootPath = useFolderStore((s) => s.rootPath);

  // 启动默认打开桌面(仅一次)
  useEffect(() => {
    if (!rootPath) void init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
