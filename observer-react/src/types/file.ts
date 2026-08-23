// 与 Rust 侧 commands.rs / formats.rs 返回结构对应的类型,以及前端通用的文件引用。

export type FileKind = "image" | "video" | "audio" | "text" | "markdown" | "unknown";

/** list_dir 返回的目录项 */
export interface DirEntry {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
  /** unix 秒 */
  mtime: number;
  /** 小写、不含点 */
  ext: string;
}

/** file_stat 返回的元数据 */
export interface FileStat {
  name: string;
  path: string;
  size: number;
  mtime: number;
  ext: string;
  is_dir: boolean;
}

/** detect_format 返回 */
export interface DetectResult {
  ext: string;
  /** 魔数嗅探出的实际格式(仅歧义后缀时给出) */
  sniffed: string | null;
  kind: FileKind;
}

/** 进入宫格的文件引用 */
export interface FileRef {
  path: string;
  name: string;
  ext: string;
  kind: FileKind;
}
