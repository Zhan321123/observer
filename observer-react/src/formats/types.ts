import type { ComponentType } from "react";
import type { FileKind, FileRef } from "../types/file";

/**
 * 预览策略(design.md §3 铁律 1:WebView 只消费安全格式)。
 * - native:      WebView 直接消费(原生图片 / 原生音视频 / 文本)
 * - ffmpeg-stream: 需 FFmpeg remux/转码(占位,后续 M1)
 * - decode-rust: 需 Rust 解码库(占位,后续 M2:RAW/HEIC/PSD/TIFF…)
 * - unsupported: 暂不识别
 */
export type Strategy = "native" | "ffmpeg-stream" | "decode-rust" | "unsupported";

export interface PreviewProps {
  file: FileRef;
  cellId: number;
  /** 是否当前选中格(决定交互是否生效) */
  active: boolean;
  /** 占位/不支持时的说明(仅 PlaceholderView 使用,由 GridCell 透传) */
  reason?: string;
  strategy?: Strategy;
  /** 覆盖图片字节来源(decode-rust 类:Rust 解码出的 PNG 经 asset://;持久化仍按原 file.path) */
  overrideSrc?: string;
}

export interface ResolvedPreview {
  kind: FileKind;
  strategy: Strategy;
  component: ComponentType<PreviewProps>;
  /** unsupported / 占位时显示的说明 */
  reason?: string;
}

/**
 * 格式处理器(design.md §5②):加一个格式 = 加一个 handler 文件,
 * 并在 registry.ts 的有序数组里登记一行。
 */
export interface FormatHandler {
  name: string;
  /** 该 handler 认识的所有扩展名(用于文件树"可预览"过滤) */
  exts: string[];
  canHandle(file: FileRef): boolean;
  resolve(file: FileRef): ResolvedPreview;
}
