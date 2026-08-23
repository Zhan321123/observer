import type { FileKind } from "../types/file";

/**
 * 命令式控制注册表(普通 Map,不是 zustand)。
 * 各预览组件挂载时注册自己的控制能力;功能条对选中格调用对应方法。
 * 数据态放 cellViewStore,这里只放"动作"。
 */
export interface CellControl {
  kind: FileKind;
  play?(): void;
  pause?(): void;
  toggle?(): void;
  seek?(t: number): void;
  stepFrame?(dir: 1 | -1): void;
  setVolume?(v: number): void;
  setRate?(r: number): void;
  setFitMode?(m: "best-fit" | "actual"): void;
  zoomIn?(): void;
  zoomOut?(): void;
  setZoom?(s: number): void;
  zoomText?(delta: number): void;
  enterFullView?(): void;
  enterFullScreen?(): void;
}

const reg = new Map<number, CellControl>();

export function registerControl(id: number, c: CellControl): () => void {
  reg.set(id, c);
  return () => {
    if (reg.get(id) === c) reg.delete(id);
  };
}

export function getControl(id: number | null): CellControl | undefined {
  return id == null ? undefined : reg.get(id);
}
