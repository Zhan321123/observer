import type { FormatHandler } from "../types";
import { SqliteView } from "../../components/preview/SqliteView";

// task2 二:SQLite 数据库 → 表/视图清单 + 分页浏览(后端 rusqlite 只读,IPC 只回 JSON)。
export const sqliteHandler: FormatHandler = {
  name: "sqlite",
  exts: ["db", "sqlite", "sqlite3", "db3"],
  canHandle: (f) => f.kind === "sqlite",
  resolve: () => ({ kind: "sqlite", strategy: "native", component: SqliteView }),
};
