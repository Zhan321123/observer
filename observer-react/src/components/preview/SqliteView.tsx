import { useEffect, useState } from "react";
import { sqliteTables, sqlitePage, type SqlitePage as PageData, type SqliteErr } from "../../lib/tauri";
import { DataTable } from "./DataTable";
import { useCellViewStore } from "../../stores/cellViewStore";
import { registerControl } from "../../stores/cellControls";
import { clamp } from "../../lib/format";
import type { PreviewProps } from "../../formats/types";

/** 每页行数(预览粒度;后端另有 500 上限护栏) */
const PAGE_SIZE = 100;

/** 结构化错误 → 宫格错误占位文案(not_sqlite 给出友好区分:LevelDB/LMDB/加密库) */
function errText(e: SqliteErr): string {
  const m = "message" in e ? e.message : undefined;
  switch (e.kind) {
    case "not_found":
      return "数据库文件不存在";
    case "not_sqlite":
      return m ?? "不是有效的 SQLite 数据库";
    case "open_failed":
      return m ?? "数据库打开失败(可能被其他程序锁定)";
    default:
      return m ?? "查询失败";
  }
}

/**
 * SQLite 浏览(task2 二):表/视图清单 + 分页数据。
 * 心智对齐 xlsx 多 sheet:功能条下拉选表(读 sqliteTables/sqliteTableIndex),
 * 上/下一页翻页(sqliteOffset),结构面板显示当前表 DDL(sqliteShowSchema)。
 * 铁律 2:后端只回 JSON(当前页 ≤100 行),数据库字节不走 IPC。
 */
export function SqliteView({ file, cellId }: PreviewProps) {
  const setView = useCellViewStore((s) => s.setView);
  const tables = useCellViewStore((s) => s.views[cellId]?.sqliteTables);
  const tableIndex = useCellViewStore((s) => s.views[cellId]?.sqliteTableIndex) ?? 0;
  const offset = useCellViewStore((s) => s.views[cellId]?.sqliteOffset) ?? 0;
  const total = useCellViewStore((s) => s.views[cellId]?.sqliteTotal) ?? 0;
  const showSchema = useCellViewStore((s) => s.views[cellId]?.sqliteShowSchema) ?? false;
  const [page, setPage] = useState<PageData | null>(null);
  const current = tables?.[tableIndex];

  // 表清单:载入即取(文件变更/重挂载时重置到第一个表;视图态随 clearView 整体回收)
  useEffect(() => {
    let cancelled = false;
    setPage(null);
    sqliteTables(file.path)
      .then((ts) => {
        if (cancelled) return;
        if (ts.length === 0) {
          setView(cellId, { error: "数据库中没有用户表(空库或全部为内部表)" });
          return;
        }
        setView(cellId, { sqliteTables: ts, sqliteTableIndex: 0, sqliteOffset: 0, sqliteTotal: 0 });
      })
      .catch((e) => {
        if (!cancelled) setView(cellId, { error: errText(e as SqliteErr) });
      });
    return () => {
      cancelled = true;
    };
  }, [file.path, cellId, setView]);

  // 分页读行(当前表 / 偏移变化时)
  useEffect(() => {
    if (!current) return;
    let cancelled = false;
    setPage(null);
    sqlitePage(file.path, current.name, offset, PAGE_SIZE)
      .then((p) => {
        if (cancelled) return;
        setPage(p);
        setView(cellId, { sqliteTotal: p.total });
      })
      .catch((e) => {
        if (!cancelled) setView(cellId, { error: errText(e as SqliteErr) });
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file.path, cellId, current?.name, offset, setView]);

  // 命令式控制(功能条:表下拉/翻页/结构面板);读 live state 防闭包过期(PdfView 先例)
  useEffect(
    () =>
      registerControl(cellId, {
        kind: "sqlite",
        setSqliteTable: (i) => setView(cellId, { sqliteTableIndex: i, sqliteOffset: 0 }),
        sqlitePageStep: (dir) => {
          const v = useCellViewStore.getState().views[cellId];
          const t = v?.sqliteTotal ?? 0;
          const pages = Math.max(1, Math.ceil(t / PAGE_SIZE));
          const cur = Math.floor((v?.sqliteOffset ?? 0) / PAGE_SIZE);
          setView(cellId, { sqliteOffset: clamp(cur + dir, 0, pages - 1) * PAGE_SIZE });
        },
        toggleSchema: () => {
          const v = useCellViewStore.getState().views[cellId];
          setView(cellId, { sqliteShowSchema: !(v?.sqliteShowSchema ?? false) });
        },
      }),
    [cellId, setView]
  );

  if (!tables || !current) {
    return <div className="p-4 text-xs text-text-dim">读取数据库…</div>;
  }
  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* 结构面板:当前表 DDL(视图可能无) */}
      {showSchema && (
        <div className="max-h-40 shrink-0 overflow-auto border-b border-line/40 bg-panel-2/60 px-3 py-2">
          <pre className="m-0 whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-text-dim">
            {current.ddl || "(无 DDL)"}
          </pre>
        </div>
      )}
      <div className="min-h-0 flex-1">
        {page ? (
          <DataTable
            rows={page.rows}
            totalRows={page.rows.length}
            totalCols={page.columns.length}
            headerRow={page.columns}
          />
        ) : (
          <div className="p-4 text-xs text-text-dim">加载中…</div>
        )}
      </div>
      {/* 页脚信息(翻页按钮在功能条;此处显示行区间,选中格可读) */}
      <div className="shrink-0 border-t border-line/40 bg-panel-2/60 px-3 py-1 text-[11px] text-text-dim">
        {current.kind === "view" ? "视图" : "表"} {current.name} · 第 {total === 0 ? 0 : offset + 1}–
        {Math.min(offset + PAGE_SIZE, total)} 行 / 共 {total.toLocaleString()} 行
      </div>
    </div>
  );
}
