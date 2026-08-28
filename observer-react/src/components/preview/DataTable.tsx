/** 预览渲染上限:防止超大表冻结 UI(解析仍全量,仅截断显示) */
export const TABLE_MAX_ROWS = 1000;
export const TABLE_MAX_COLS = 100;

interface Props {
  /** 二维行数据(已按上限截断) */
  rows: unknown[][];
  /** 未截断的总行数 / 总列数(用于截断提示) */
  totalRows: number;
  totalCols: number;
  /** 可选表头行(SQLite 浏览,task2 二):sticky 顶部;不传则全部按数据行渲染(xlsx/csv 现状) */
  headerRow?: string[];
}

/**
 * 通用表格渲染(xlsx / csv / SQLite 共用)。sticky 行号列、斑马纹、超上限截断提示。
 * 容器 select-text:在全局 user-select:none 下 opt-in,允许拖选单元格文字后复制。
 */
export function DataTable({ rows, totalRows, totalCols, headerRow }: Props) {
  const truncated = totalRows > TABLE_MAX_ROWS || totalCols > TABLE_MAX_COLS;

  return (
    <div className="h-full w-full select-text overflow-auto bg-panel">
      <table className="border-collapse text-[12px] text-text">
        {headerRow && (
          <thead className="sticky top-0 z-10">
            <tr>
              <th className="sticky left-0 select-none border border-line/40 bg-panel-2 px-1.5 py-0.5 text-right text-[10px] font-normal text-text-dim/50">
                #
              </th>
              {headerRow.map((h, i) => (
                <th
                  key={i}
                  className="whitespace-nowrap border border-line/40 bg-panel-2 px-2 py-0.5 text-left font-semibold"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {rows.map((r, ri) => (
            <tr key={ri} className={ri % 2 ? "bg-panel-2/40" : ""}>
              <td className="sticky left-0 select-none border border-line/40 bg-panel-2 px-1.5 py-0.5 text-right text-[10px] text-text-dim/50">
                {ri + 1}
              </td>
              {r.map((c, ci) => (
                <td key={ci} className="whitespace-nowrap border border-line/40 px-2 py-0.5 align-top">
                  {c == null ? "" : String(c)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && <div className="p-6 text-center text-xs text-text-dim">(空表)</div>}
      {truncated && (
        <div className="sticky bottom-0 select-none bg-panel-2 px-3 py-1 text-[11px] text-text-dim">
          已截断:仅显示前 {Math.min(totalRows, TABLE_MAX_ROWS)} 行 × {Math.min(totalCols, TABLE_MAX_COLS)} 列(共{" "}
          {totalRows} 行 × {totalCols} 列)
        </div>
      )}
    </div>
  );
}
