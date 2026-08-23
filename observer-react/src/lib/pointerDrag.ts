import { useDragStore, type DragData } from "../stores/dragStore";
import { useGridStore } from "../stores/gridStore";
import { detectFormat } from "./tauri";
import { kindForExt } from "../formats/registry";

const DRAG_THRESHOLD = 5; // px,超过才算拖拽(避免误触点击)

// 拖拽结束后短暂抑制 source 元素的 click(防止拖回原位时误触发"点击打开")
let lastDragEndAt = 0;
/** 拖拽源的 onClick 调用此函数;若刚结束过拖拽则返回 true(应忽略本次点击) */
export function suppressClickAfterDrag(): boolean {
  return Date.now() - lastDragEndAt < 200;
}

/**
 * 在某个可拖元素上发起 pointer 拖拽。在 onPointerDown 里调用。
 * - 超过阈值才开始拖(保留原有点击行为);
 * - 拖动中用 document.elementFromPoint 命中测试落点宫格;
 * - 松手时对落点执行动作(文件→覆盖该格 / 宫格→移动)。
 */
export function startPointerDrag(e: React.PointerEvent, data: DragData) {
  if (e.button !== 0) return; // 只响应左键
  const startX = e.clientX;
  const startY = e.clientY;
  let started = false;

  const onMove = (ev: PointerEvent) => {
    const x = ev.clientX;
    const y = ev.clientY;
    if (!started) {
      if (Math.hypot(x - startX, y - startY) < DRAG_THRESHOLD) return;
      started = true;
      useDragStore.getState().begin(data, x, y);
    }
    useDragStore.getState().move(x, y, hitCell(x, y));
  };

  const onUp = (ev: PointerEvent) => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    if (started) {
      lastDragEndAt = Date.now();
      const target = hitCell(ev.clientX, ev.clientY);
      void performDrop(data, target);
      useDragStore.getState().end();
    }
  };

  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
}

function hitCell(x: number, y: number): number | null {
  const el = document.elementFromPoint(x, y);
  const cellEl = el?.closest("[data-cell-id]");
  return cellEl ? Number((cellEl as HTMLElement).dataset.cellId) : null;
}

async function performDrop(data: DragData, targetCellId: number | null) {
  if (targetCellId == null) return; // 落在宫格外 → 取消
  const grid = useGridStore.getState();

  if (data.kind === "cell") {
    grid.moveCell(data.from, targetCellId);
    return;
  }
  // 文件 → 经 detect_format 嗅探定 kind(区分 .ts/.m4s 等歧义后缀),强制覆盖该格
  const d = await detectFormat(data.path).catch(() => null);
  grid.placeFileAt(targetCellId, {
    path: data.path,
    name: data.name,
    ext: data.ext,
    kind: d?.kind ?? kindForExt(data.ext),
  });
}
