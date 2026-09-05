/**
 * Lottie 兼容处理(§修复:部分 JSON 打开空白)。
 *
 * 根因:lottie-web 的 renderFrame 对每帧渲染包了 try/catch,任何一层抛错(典型:表达式
 * 求值失败,如 effect('…')('ADBE Slider Control-0001') 按 matchName 查不到)整帧不画,
 * 只触发 'error' 事件——不订阅就是"空白且无提示"。兜底:剥掉表达式键后重载,
 * 动画可正常播放(仅丢表达式驱动的次级动效,如回弹/过冲)。
 */

/** 判断 "x" 键是否为 Bodymovin 表达式形态:string 或含 string 的数组。
 *  (关键帧缓动的 "x" 是 {x:[0.833]} 之类的数字/对象,不受影响。) */
function isExpression(v: unknown): boolean {
  if (typeof v === "string") return true;
  return Array.isArray(v) && v.some((e) => typeof e === "string");
}

/** 原地深遍历删除所有表达式键("x" 为表达式形态时)。 */
export function stripExpressions(node: unknown): void {
  if (Array.isArray(node)) {
    node.forEach(stripExpressions);
    return;
  }
  if (node && typeof node === "object") {
    const o = node as Record<string, unknown>;
    if ("x" in o && isExpression(o.x)) delete o.x;
    for (const k of Object.keys(o)) stripExpressions(o[k]);
  }
}

/** 缺 w/h(或 ≤0)时兜底 512:lottie-web 拿它写 viewBox,缺失会得到 "0 0 undefined undefined" → 空白。 */
export function guardSize(data: { w?: number; h?: number }): void {
  if (!data.w || !Number.isFinite(data.w) || data.w <= 0) data.w = 512;
  if (!data.h || !Number.isFinite(data.h) || data.h <= 0) data.h = 512;
}
