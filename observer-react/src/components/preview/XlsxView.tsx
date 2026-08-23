import { useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { assetUrl, allowAssetPath } from "../../lib/tauri";
import { useCellViewStore } from "../../stores/cellViewStore";
import { registerControl } from "../../stores/cellControls";
import { DataTable, TABLE_MAX_ROWS, TABLE_MAX_COLS } from "./DataTable";
import type { PreviewProps } from "../../formats/types";

/**
 * XLSX 表格预览(§第二批:新增 xlsx 支持,工具条下拉选 sheet,默认第一个)。
 * 字节经 asset:// fetch → XLSX.read(铁律 2);SheetNames 写入 store 供工具条下拉,
 * 当前 sheet 经 DataTable 渲染(行列超上限截断显示)。
 */
export function XlsxView({ file, cellId }: PreviewProps) {
  const setView = useCellViewStore((s) => s.setView);
  const sheetIndex = useCellViewStore((s) => s.views[cellId]?.sheetIndex) ?? 0;

  const [wb, setWb] = useState<XLSX.WorkBook | null>(null);
  // wb 同步进 ref:setSheet 控制闭包读 ref,避免功能条渲染期快照拿到 wb=null 的旧闭包
  const wbRef = useRef<XLSX.WorkBook | null>(null);

  useEffect(() => {
    let cancelled = false;
    setWb(null);
    wbRef.current = null;
    (async () => {
      try {
        await allowAssetPath(file.path).catch(() => {});
        const buf = await fetch(assetUrl(file.path)).then((r) => r.arrayBuffer());
        const book = XLSX.read(buf, { type: "array" });
        if (cancelled) return;
        if (!book.SheetNames.length) throw new Error("no sheets");
        wbRef.current = book;
        setWb(book);
        setView(cellId, { sheetNames: book.SheetNames, sheetIndex: 0 });
      } catch {
        if (!cancelled) setView(cellId, { error: "表格解析失败(文件损坏或格式异常)" });
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file.path, cellId]);

  // 命令式控制(功能条 sheet 下拉)。deps 不含 wb:读 wbRef,不随解析重注册
  useEffect(
    () =>
      registerControl(cellId, {
        kind: "spreadsheet",
        setSheet: (i) => {
          const book = wbRef.current;
          if (book && i >= 0 && i < book.SheetNames.length) setView(cellId, { sheetIndex: i });
        },
      }),
    [cellId, setView]
  );

  // 当前 sheet → 行数组(header:1 得二维数组;defval 补空单元格)
  const { rows, totalRows, totalCols } = useMemo(() => {
    if (!wb) return { rows: [] as unknown[][], totalRows: 0, totalCols: 0 };
    const name = wb.SheetNames[Math.min(sheetIndex, wb.SheetNames.length - 1)];
    const ws = wb.Sheets[name];
    if (!ws) return { rows: [] as unknown[][], totalRows: 0, totalCols: 0 };
    const all = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: false, defval: "" });
    const totalRows = all.length;
    const totalCols = all.reduce((m, r) => Math.max(m, r.length), 0);
    const rows = all.slice(0, TABLE_MAX_ROWS).map((r) => r.slice(0, TABLE_MAX_COLS));
    return { rows, totalRows, totalCols };
  }, [wb, sheetIndex]);

  if (!wb) {
    return <div className="flex h-full w-full items-center justify-center text-text-dim">解析中…</div>;
  }

  return <DataTable rows={rows} totalRows={totalRows} totalCols={totalCols} />;
}
