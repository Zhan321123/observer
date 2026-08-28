import { useEffect } from "react";
import { registerControl } from "../../stores/cellControls";
import { ArchiveTree } from "./ArchiveTree";
import type { PreviewProps } from "../../formats/types";

/**
 * 压缩包目录预览(task2):kind=archive 的壳。树体/密码流程在 ArchiveTree
 * (XlsxView 双身份"压缩包目录"视角复用同一组件)。功能条暂无压缩包专属按钮
 * (全界面/全屏不做,§4.6 只列图片/视频/PDF/3D),只登记控制占位。
 */
export function ArchiveView({ file, cellId, active }: PreviewProps) {
  useEffect(() => registerControl(cellId, { kind: "archive" }), [cellId]);
  return <ArchiveTree file={file} cellId={cellId} active={active} />;
}
