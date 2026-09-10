// 所有 invoke IPC 的唯一出口。铁律 2:媒体字节走 asset://(convertFileSrc),不走这里。
// 这里只传元数据 / JSON / 文本。唯一例外:convertWrite 的转换产物(输出方向,见 M5 节)。

import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import type { DirEntry, FileStat, DetectResult, VideoMeta } from "../types/file";

/** 本地文件 → WebView 可加载的 URL(Windows 实为 http://asset.localhost,macOS/Linux 为 asset://) */
export const assetUrl = (p: string) => convertFileSrc(p);

export const listDir = (path: string) => invoke<DirEntry[]>("list_dir", { path });

/** collect_audio_files 的返回:递归收集的音频文件(播放器队列;DFS 序=每层目录在前文件在后逐层下探) */
export interface AudioFileEntry {
  path: string;
  name: string;
  ext: string;
}
/** 递归收集目录树中扩展名命中的音频文件(exts 由前端 audio.ts 提供,TRACKER 排除;只传元数据) */
export const collectAudioFiles = (path: string, exts: string[]) =>
  invoke<AudioFileEntry[]>("collect_audio_files", { path, exts });

/** read_text_file 的返回:解码文本 + 检测出的编码名(如 "UTF-8"/"GBK"/"UTF-16LE",供信息框) */
export interface TextContent {
  text: string;
  encoding: string;
}
export const readTextFile = (path: string) => invoke<TextContent>("read_text_file", { path });
export const fileStat = (path: string) => invoke<FileStat>("file_stat", { path });
export const detectFormat = (path: string) => invoke<DetectResult>("detect_format", { path });
export const revealInExplorer = (path: string) => invoke<void>("reveal_in_explorer", { path });
/** 运行时给 asset 协议授权用户打开的目录/文件(配合静态宽 scope 双保险) */
export const allowAssetPath = (path: string) => invoke<void>("allow_asset_path", { path });

export const copyPath = (path: string) => writeText(path);
export const openFolderDialog = () => open({ directory: true, multiple: false });

/** 解析 Markdown 链接为本地文件绝对路径(不存在/外链 → null,外链由前端走浏览器) */
export const resolveLink = (baseFile: string, href: string) =>
  invoke<string | null>("resolve_link", { baseFile, href });

// ---- M1:FFmpeg 流 / 元信息 / 缩略图(字节走 loopback HTTP,这里只传元数据) ----
export const streamBaseUrl = () => invoke<string>("stream_base_url");
export const ffprobeMeta = (path: string) => invoke<VideoMeta>("ffprobe_meta", { path });
export const videoThumbnail = (path: string, at?: number) =>
  invoke<string>("video_thumbnail", { path, at });
/** M2 图片解码:tiff/tga/exr/psd/RAW/HEIC 等 → 磁盘缓存 PNG,返回路径(前端经 asset:// 加载) */
export const decodeImage = (path: string) => invoke<string>("decode_image", { path });
/** 拼接某文件从 t 秒起的流式地址(loopback HTTP,seek=改 t 重启) */
export const streamUrl = (base: string, path: string, t: number) =>
  `${base}/stream?path=${encodeURIComponent(path)}&t=${t.toFixed(3)}`;

// ---- M3 音频进阶 ----
/** 波形峰值:FFmpeg 解码 → 单声道 8k s16 → 每桶 [min,max] 归一化到 ±1(buckets 默认 1000;
 *  后端固定按 4096 桶磁盘缓存,任意 buckets 由内存重分桶满足) */
export const audioWaveform = (path: string, buckets?: number) =>
  invoke<Array<[number, number]>>("audio_waveform", { path, buckets });
/** MIDI:rustysynth SoundFont 合成 → WAV 磁盘缓存,返回路径(前端经 asset:// 原生播放) */
export const midiRender = (path: string, soundfont?: string) =>
  invoke<string>("midi_render", { path, soundfont });

// ---- task2 压缩包目录预览 ----
/** 压缩包条目元数据(archive_list 返回;只读中央目录/头,不解压数据) */
export interface ArchiveEntry {
  /** 包内相对路径,'/' 分隔 */
  path: string;
  name: string;
  is_dir: boolean;
  size: number;
  /** unix 秒;0 = 无值 */
  mtime: number;
  encrypted: boolean;
}

/** archive_list 的结构化错误(本代码库第一个结构化命令错误):kind 判别类别。
 *  header_encrypted / wrong_password → 密码框视图;其余 → 宫格错误占位。 */
export type ArchiveErr =
  | { kind: "header_encrypted" }
  | { kind: "wrong_password" }
  | { kind: "corrupted"; message: string }
  | { kind: "unsupported"; message: string }
  | { kind: "io"; message: string }
  | { kind: "not_archive"; message: string };

/** 列压缩包目录(zip/rar/7z)。pwd 仅头加密包(rar -hp / 7z -mhe=on)需要 */
export const archiveList = (path: string, pwd?: string | null) =>
  invoke<ArchiveEntry[]>("archive_list", { path, pwd: pwd ?? null });
/** 已记住的压缩包密码(按绝对路径;task2 §4 明文存 SQLite) */
export const archivePwdGet = (path: string) =>
  invoke<string | null>("archive_pwd_get", { path });
export const archivePwdSet = (path: string, pwd: string) =>
  invoke<void>("archive_pwd_set", { path, pwd });

// ---- task2 二:SQLite 浏览(后端 rusqlite 只读;铁律 2:IPC 只回 JSON,字节不出库) ----
export interface SqliteTable {
  name: string;
  kind: "table" | "view";
  /** 建表 DDL(结构面板) */
  ddl: string;
}
export interface SqlitePage {
  columns: string[];
  /** 值为 JSON:null / 数字 / 字符串(BLOB 已在后端转占位符) */
  rows: unknown[][];
  total: number;
}
export type SqliteErr =
  | { kind: "not_found"; message?: string }
  | { kind: "not_sqlite"; message?: string }
  | { kind: "open_failed"; message?: string }
  | { kind: "query_failed"; message?: string };
export const sqliteTables = (path: string) => invoke<SqliteTable[]>("sqlite_tables", { path });
export const sqlitePage = (path: string, table: string, offset: number, limit?: number) =>
  invoke<SqlitePage>("sqlite_page", { path, table, offset, limit: limit ?? null });

// ---- M5 格式转换(3D 导出) ----
/** Uint8Array → base64。分块(0x8000)拼接:String.fromCharCode.apply 有参数栈上限,
 *  整段 spread 大数组会 RangeError。 */
export function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}
/** convert_write:转换产物写入 dir/filename(重名自动 " (n)",绝不覆盖),返回最终写入路径。
 *  铁律 2(媒体字节不走 IPC)的首个输出侧例外:产物由前端(three.js exporter)生成,
 *  asset:// 输入管道不适用;v1 以 base64 走 JSON 单命令(单任务、MB 级,~1.33x 膨胀可接受)。 */
export const convertWrite = (dir: string, filename: string, dataB64: string) =>
  invoke<string>("convert_write", { dir, filename, dataB64 });
