// 所有 invoke IPC 的唯一出口。铁律 2:媒体字节走 asset://(convertFileSrc),不走这里。
// 这里只传元数据 / JSON / 文本。

import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import type { DirEntry, FileStat, DetectResult, VideoMeta } from "../types/file";

/** 本地文件 → WebView 可加载的 URL(Windows 实为 http://asset.localhost,macOS/Linux 为 asset://) */
export const assetUrl = (p: string) => convertFileSrc(p);

export const listDir = (path: string) => invoke<DirEntry[]>("list_dir", { path });
export const readTextFile = (path: string) => invoke<string>("read_text_file", { path });
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
/** 拼接某文件从 t 秒起的流式地址(loopback HTTP,seek=改 t 重启) */
export const streamUrl = (base: string, path: string, t: number) =>
  `${base}/stream?path=${encodeURIComponent(path)}&t=${t.toFixed(3)}`;
