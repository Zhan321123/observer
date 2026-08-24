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

// ---- 记录管理(design.md §9.4):各类记录的 list / remove / clear / 清理失效 / 保留策略 ----
export interface MediaPosRow {
  path: string;
  position: number;
  duration: number | null;
  volume: number | null;
  rate: number | null;
  updated_at: number;
}
export interface DocPosRow {
  path: string;
  page: number | null;
  scroll_x: number | null;
  scroll_y: number | null;
  zoom: number | null;
  updated_at: number;
}
export interface ThreeDRow {
  path: string;
  camera: string;
  updated_at: number;
}
export const mediaPosList = () => invoke<MediaPosRow[]>("media_pos_list");
export const mediaPosRemove = (path: string) => invoke<void>("media_pos_remove", { path });
export const mediaPosClear = () => invoke<void>("media_pos_clear");
export const docPosList = () => invoke<DocPosRow[]>("doc_pos_list");
export const docPosRemove = (path: string) => invoke<void>("doc_pos_remove", { path });
export const docPosClear = () => invoke<void>("doc_pos_clear");
export const threedList = () => invoke<ThreeDRow[]>("threed_list");
export const threedRemove = (path: string) => invoke<void>("threed_remove", { path });
export const threedClear = () => invoke<void>("threed_clear");
/** 一键清理失效(文件已不存在)历史,返回删除条数 */
export const historyPurgeMissing = () => invoke<number>("history_purge_missing");
/** 保留策略:仅保留最近打开的 limit 条历史,返回删除条数 */
export const historyApplyRetention = (limit: number) =>
  invoke<number>("history_apply_retention", { limit });
