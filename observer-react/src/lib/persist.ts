// SQLite 持久化层的前端出口(design.md §9,后端见 observer-tauri/src/db.rs)。
// 只传元数据/JSON;媒体字节绝不走这里(铁律 2)。

import { invoke } from "@tauri-apps/api/core";

// ---- app_state(键值单例:当前文件夹 / 宫格布局等) ----
export const stateGet = (key: string) => invoke<string | null>("app_state_get", { key });
export const stateSet = (key: string, value: string) =>
  invoke<void>("app_state_set", { key, value });

// ---- preview_history(预览历史) ----
export interface HistoryRow {
  path: string;
  size: number;
  mtime: number;
  open_count: number;
  first_opened: number;
  last_opened: number;
  missing: boolean;
}
export const historyOpen = (path: string) => invoke<void>("history_open", { path });
export const historyList = () => invoke<HistoryRow[]>("history_list");
export const historyRemove = (path: string) => invoke<void>("history_remove", { path });
export const historyClear = () => invoke<void>("history_clear");

// ---- media_position(视频/音频播放位置 + 音量/倍速,按文件) ----
export interface MediaPos {
  position: number;
  duration: number | null;
  volume: number | null;
  rate: number | null;
}
export const mediaPosGet = (path: string) => invoke<MediaPos | null>("media_pos_get", { path });
export const mediaPosSet = (
  path: string,
  position: number,
  duration: number | null,
  volume: number | null,
  rate: number | null
) => invoke<void>("media_pos_set", { path, position, duration, volume, rate });

// ---- doc_position(文本/PDF 滚动位置;图片平移/缩放复用) ----
export interface DocPos {
  page: number | null;
  scroll_x: number | null;
  scroll_y: number | null;
  zoom: number | null;
}
export const docPosGet = (path: string) => invoke<DocPos | null>("doc_pos_get", { path });
export const docPosSet = (
  path: string,
  page: number | null,
  scrollX: number | null,
  scrollY: number | null,
  zoom: number | null
) => invoke<void>("doc_pos_set", { path, page, scrollX, scrollY, zoom });
