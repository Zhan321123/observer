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
  /** 文本:行号开关 */
  toggleLineNumbers?(): void;
  /** 文本:自动换行开关 */
  toggleWordWrap?(): void;
  /** 文本:复制全文 */
  copyAll?(): void;
  /** Lottie:动画/文本模式切换 */
  toggleLottieMode?(): void;
  /** Markdown:预览/文本模式切换 */
  toggleMarkdownMode?(): void;
  /** GIF:逐帧步进 */
  gifStep?(dir: 1 | -1): void;
  /** GIF:播放/暂停 */
  gifTogglePlay?(): void;
  /** ICO:选择尺寸下标 */
  setIcoSize?(i: number): void;
  /** xlsx:选择 sheet 下标 */
  setSheet?(i: number): void;
  /** xlsx 双身份(task2 §5):表格/压缩包目录视角切换 */
  toggleXlsxMode?(): void;
  /** 含透明图层图片:透明棋盘格背景开关 */
  toggleTransparencyGrid?(): void;
  /** CSV/TSV:表格/文本模式切换 */
  toggleCsvMode?(): void;
  /** SVG:预览/文本源码模式切换 */
  toggleSvgMode?(): void;
  /** PDF:翻页 */
  pdfStep?(dir: 1 | -1): void;
  /** 3D:重置视角(回自适应取景) */
  threedReset?(): void;
  /** 3D:自动旋转开关 */
  toggleThreedAutoRotate?(): void;
  /** 3D:线框模式开关 */
  toggleThreedWireframe?(): void;
  /** 3D:平面网格显示开关 */
  toggleThreedGrid?(): void;
  /** 3D:光照环境切换(循环预设) */
  cycleThreedLight?(): void;
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
