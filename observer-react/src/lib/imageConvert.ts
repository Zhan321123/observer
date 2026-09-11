// M5 图片转换的纯逻辑(目标集/输出数/警告矩阵),与 Rust imgconvert.rs 的语义对齐。
// 不含任何 IPC 调用,便于独立 review;ConvertPanel 消费。

import type { ImageInfo } from "./tauri";

export type ImageTargetFormat = "png" | "jpg" | "webp" | "tiff" | "bmp" | "ico" | "gif";

/** 全部目标格式(即下拉顺序)。SVG 不做目标——位图→矢量不在范围(task.md M5);
 *  AVIF 编码未启用(ravif 重依赖)。允许与源同格式重编码(循 glb→glb 先例)。 */
export const IMAGE_TARGETS: readonly ImageTargetFormat[] = [
  "png",
  "jpg",
  "webp",
  "tiff",
  "bmp",
  "ico",
  "gif",
];

export const IMAGE_TARGET_LABELS: Record<ImageTargetFormat, string> = {
  png: "PNG",
  jpg: "JPEG",
  webp: "WebP",
  tiff: "TIFF",
  bmp: "BMP",
  ico: "ICO",
  gif: "GIF",
};

/** 8bit-only 编码目标(16/32 位源转这些降深度;PNG/TIFF 可保 16 位) */
const EIGHT_BIT_ONLY: readonly ImageTargetFormat[] = ["jpg", "webp", "bmp", "ico", "gif"];

/** 目标集按源排除:avif → null(面板出说明文案,无表单);其余全集 */
export function targetsForSource(ext: string | undefined): readonly ImageTargetFormat[] | null {
  const e = (ext ?? "").toLowerCase();
  if (e === "avif") return null;
  return IMAGE_TARGETS;
}

/** 输出文件数:动画源且目标非 gif → frameCount;多条目 ICO 且目标非 ico → icoCount;否则 1 */
export function imageOutputCount(
  ext: string | undefined,
  info: ImageInfo | null,
  format: ImageTargetFormat,
): number {
  if (!info) return 1;
  const e = (ext ?? "").toLowerCase();
  if (info.animated && info.frameCount > 1 && format !== "gif") return info.frameCount;
  if (e === "ico" && info.icoCount > 1 && format !== "ico") return info.icoCount;
  return 1;
}

/** 转换确认弹窗的警告列表(全部基于 image_info 的格式级事实,措辞用"可能";
 *  info 为 null/过期时返回空,不阻塞转换——真实错误在转换时如实暴露)。 */
export function imageConvertWarnings(
  ext: string | undefined,
  info: ImageInfo | null,
  format: ImageTargetFormat,
): string[] {
  if (!info) return [];
  const e = (ext ?? "").toLowerCase();
  const w: string[] = [];
  // 透明 → 无透明目标(仅 JPEG;BMP 32bit RGBA 可保)
  if (info.hasAlpha && format === "jpg") {
    w.push(
      "源格式可能含透明通道,JPEG 不支持透明,转换后透明将丢失(透明像素按白色背景压平)。",
    );
  }
  // 动画源 → 静态目标:拆帧多张
  if (info.animated && info.frameCount > 1 && format !== "gif") {
    const src = e === "gif" ? "GIF" : e === "webp" ? "WebP" : "APNG";
    w.push(`源为 ${src} 动画(共 ${info.frameCount} 帧),将输出 ${info.frameCount} 张静态图片(自 _001 起编号)。`);
  }
  // 多条目 ICO → 非 ICO 目标:按尺寸多张
  if (e === "ico" && info.icoCount > 1 && format !== "ico") {
    w.push(`源 ICO 含 ${info.icoCount} 个尺寸,将输出 ${info.icoCount} 张图片(按尺寸命名,如 _256)。`);
  }
  // 位深降低
  if (info.bitDepth > 8 && EIGHT_BIT_ONLY.includes(format)) {
    const hdr =
      info.bitDepth >= 32 ? "高动态范围将直接截断(与预览行为一致,不做色调映射)。" : "";
    w.push(`色彩深度将从 ${info.bitDepth} 位降至 8 位。${hdr}`);
  }
  // GIF 目标:256 色量化(任意源都会发生;动画源保留动画与延时)
  if (format === "gif") {
    w.push("GIF 色彩上限 256 色,转换将重新调色量化,渐变与照片可能出现色带。");
    if (info.animated && info.frameCount > 1) {
      w.push("动画帧与帧延时会保留。");
    }
  }
  // ICO 目标:目录宽高字段单字节,超 256 只能按 256 记录(输出不缩放)
  if (format === "ico" && info.width > 0 && Math.max(info.width, info.height) > 256) {
    w.push("源尺寸超过 256×256,ICO 目录按 256 记录该尺寸,部分程序可能识别异常(输出保持原尺寸,不缩放)。");
  }
  return w;
}
