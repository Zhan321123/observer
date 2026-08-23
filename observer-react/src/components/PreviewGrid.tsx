import { useGridStore } from "../stores/gridStore";
import { GridCell } from "./GridCell";

/** 预览 frame(中央宫格区)。网格行列由 gridStore 决定。 */
export function PreviewGrid() {
  const cols = useGridStore((s) => s.cols);
  const rows = useGridStore((s) => s.rows);
  const cells = useGridStore((s) => s.cells);

  return (
    <div
      className="grid h-full w-full gap-[3px] bg-ink p-[3px]"
      style={{
        gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
        gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`,
      }}
    >
      {cells.map((c) => (
        <GridCell key={c.id} id={c.id} />
      ))}
    </div>
  );
}
