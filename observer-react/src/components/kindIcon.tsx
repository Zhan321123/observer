import {
  File as FileIcon,
  Image as ImageIcon,
  Film,
  Music,
  Table2,
  BookOpen,
  FileText,
  Boxes,
  Sparkles,
  FileArchive,
  Type,
  Database,
  type LucideIcon,
} from "lucide-react";
import type { FileKind } from "../types/file";

/** 文件类别 → 行内图标 + 配色(细致区分;替代缩略图位图,树行更轻、类型一目了然)。
 *  FileTree(文件树)与 ArchiveTree(压缩包目录树,task2)共用。 */
export const KIND_ICON: Record<FileKind, { Icon: LucideIcon; cls: string }> = {
  image: { Icon: ImageIcon, cls: "text-violet-400/80" },
  video: { Icon: Film, cls: "text-sky-400/80" },
  audio: { Icon: Music, cls: "text-rose-400/80" },
  spreadsheet: { Icon: Table2, cls: "text-emerald-400/80" },
  document: { Icon: FileText, cls: "text-sky-400/80" },
  font: { Icon: Type, cls: "text-violet-400/80" },
  sqlite: { Icon: Database, cls: "text-amber-400/80" },
  pdf: { Icon: BookOpen, cls: "text-red-400/80" },
  threed: { Icon: Boxes, cls: "text-amber-400/80" },
  anim: { Icon: Sparkles, cls: "text-fuchsia-400/80" },
  markdown: { Icon: FileText, cls: "text-indigo-300/80" },
  text: { Icon: FileText, cls: "text-text-dim" },
  archive: { Icon: FileArchive, cls: "text-teal-400/80" },
  unknown: { Icon: FileIcon, cls: "text-text-dim" },
};
