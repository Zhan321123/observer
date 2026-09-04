// DXF(CAD 图纸交换格式,task2 三)→ three.js 几何。
// 库选型说明:three r185 官方并无 DXFLoader(task2 原记录有误,从未进过 examples),
// 故用 dxf-parser(纯 JS 解析器,MIT,自带 ACI 色表)出实体表,在此自绘归一化:
// 全部线类实体合并进单个 LineSegments(顶点色),大图纸也只占 1 个 draw call。
// 支持实体:LINE / LWPOLYLINE / POLYLINE(含 bulge 圆弧段)/ CIRCLE / ARC / ELLIPSE /
// SPLINE(de Boor 递推,缺节点向量时均匀夹持兜底)/ 3DFACE / SOLID /
// INSERT(块递归展开,含 MINSERT 行列阵列)。图层 off/frozen、图纸空间实体跳过;
// 文字(TEXT/MTEXT)/ 标注 / 填充等不渲染,计入 skipped。
// 本模块由 threeLoader.ts 引用,随 three chunk 懒加载,不进主包。
// TODO(大文件):dxf-parser 为同步解析,数十 MB 的图纸会卡主线程数秒,后续可挪 Worker。

import * as THREE from "three";
import DxfParser from "dxf-parser";
import AutoCadColorIndex from "dxf-parser/dist/AutoCadColorIndex.js";
import type {
  I3DfaceEntity,
  IArcEntity,
  ICircleEntity,
  IDxf,
  IEntity,
  IEllipseEntity,
  IInsertEntity,
  ILayer,
  ILineEntity,
  ILwpolylineEntity,
  IPoint,
  IPolylineEntity,
  ISolidEntity,
  ISplineEntity,
} from "dxf-parser";

type V3 = [number, number, number];
type RGB = [number, number, number];
/** 仿射变换(INSERT 块实例:缩放 → 绕 Z 旋转 → 平移,再交给外层) */
type Xf = (x: number, y: number, z: number) => V3;

interface Out {
  pos: number[];
  col: number[];
  skipped: number;
}

const IDENTITY: Xf = (x, y, z) => [x, y, z];

/** 外层变换 ∘ (缩放+绕Z旋转+平移) */
function compose(outer: Xf, scale: V3, rotDeg: number, t: IPoint): Xf {
  const r = (rotDeg * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  return (x, y, z) => {
    const sx = x * scale[0];
    const sy = y * scale[1];
    return outer(
      sx * cos - sy * sin + t.x,
      sx * sin + sy * cos + t.y,
      z * scale[2] + t.z
    );
  };
}

/** ACI 索引色 → [0,1]³ RGB。0/256 为 ByBlock/ByLayer 继承值,不在此查表;无效 → 白。 */
function aciToRgb(aci: number): RGB {
  const i = Math.abs(Math.round(aci));
  const v = i >= 1 && i <= 255 ? AutoCadColorIndex[i] : 0;
  if (v > 0) return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
  return [1, 1, 1]; // 深底色下白色可辨
}

/** 实体色:实体 ACI(非 ByLayer/ByBlock)→ 图层 ACI → 白兜底 */
function entityColor(e: IEntity, layer: ILayer | undefined): RGB {
  const ci = e.colorIndex;
  if (ci != null && ci !== 256 && ci !== 0) return aciToRgb(ci);
  const lc = layer?.colorIndex;
  if (lc != null && lc !== 256 && lc !== 0) return aciToRgb(lc);
  return aciToRgb(7);
}

/** 整圆细分段数(5°/段;大图够圆,小图略费,无碍) */
const FULL_CIRCLE_SEGS = 72;

function v3(p: { x: number; y: number; z?: number }): V3 {
  return [p.x, p.y, p.z ?? 0];
}

function pushSeg(out: Out, xf: Xf, p1: V3, p2: V3, c: RGB): void {
  const a = xf(p1[0], p1[1], p1[2]);
  const b = xf(p2[0], p2[1], p2[2]);
  out.pos.push(a[0], a[1], a[2], b[0], b[1], b[2]);
  out.col.push(c[0], c[1], c[2], c[0], c[1], c[2]);
}

/** 折线(连续段;closed 补首尾闭合) */
function emitPolyline(out: Out, xf: Xf, pts: V3[], closed: boolean, c: RGB): void {
  for (let i = 0; i + 1 < pts.length; i++) pushSeg(out, xf, pts[i], pts[i + 1], c);
  if (closed && pts.length > 2) pushSeg(out, xf, pts[pts.length - 1], pts[0], c);
}

/** 单段 bulge 弧:由两端点与 bulge(=tan(包含角/4),0=直线)反解圆心,按包含角细分 */
function emitBulge(out: Out, xf: Xf, p1: V3, p2: V3, bulge: number, c: RGB): void {
  if (!bulge) {
    pushSeg(out, xf, p1, p2, c);
    return;
  }
  const theta = 4 * Math.atan(bulge); // 有符号包含角(bulge>0 = 逆时针)
  const dx = p2[0] - p1[0];
  const dy = p2[1] - p1[1];
  const chord = Math.hypot(dx, dy);
  if (chord < 1e-12) return;
  const half = theta / 2;
  const r = Math.abs(chord / (2 * Math.sin(half)));
  // 圆心在弦中点沿左法线偏移 r·cos(θ/2);θ>π 时 cos 变号,自动换到另一侧
  const h = r * Math.cos(half);
  const cx = (p1[0] + p2[0]) / 2 - (dy / chord) * h;
  const cy = (p1[1] + p2[1]) / 2 + (dx / chord) * h;
  const a1 = Math.atan2(p1[1] - cy, p1[0] - cx);
  const segs = Math.min(256, Math.max(2, Math.ceil((Math.abs(theta) / (Math.PI * 2)) * FULL_CIRCLE_SEGS)));
  let prev = p1;
  for (let k = 1; k <= segs; k++) {
    const a = a1 + (theta * k) / segs;
    const p: V3 = [cx + r * Math.cos(a), cy + r * Math.sin(a), p1[2]];
    pushSeg(out, xf, prev, p, c);
    prev = p;
  }
}

/** LWPOLYLINE / POLYLINE 顶点序列(顶点可带 bulge) */
function emitBulgePolyline(
  out: Out,
  xf: Xf,
  verts: { x: number; y: number; z?: number; bulge?: number }[],
  closed: boolean,
  c: RGB
): void {
  const n = verts.length;
  if (n < 2) return;
  for (let i = 0; i + 1 < n; i++) emitBulge(out, xf, v3(verts[i]), v3(verts[i + 1]), verts[i].bulge || 0, c);
  if (closed && n > 2) emitBulge(out, xf, v3(verts[n - 1]), v3(verts[0]), verts[n - 1].bulge || 0, c);
}

/** ARC/CIRCLE:角度已被 dxf-parser 转为弧度,自 startAngle 逆时针扫到 endAngle */
function emitArc(out: Out, xf: Xf, e: IArcEntity, c: RGB): void {
  const start = e.startAngle ?? 0;
  let sweep = (e.endAngle ?? Math.PI * 2) - start;
  while (sweep <= 0) sweep += Math.PI * 2; // end==start 视为整圆
  const r = e.radius;
  if (!(r > 0)) return;
  const segs = Math.max(4, Math.ceil((sweep / (Math.PI * 2)) * FULL_CIRCLE_SEGS));
  const pts: V3[] = [];
  for (let k = 0; k <= segs; k++) {
    const a = start + (sweep * k) / segs;
    pts.push([e.center.x + r * Math.cos(a), e.center.y + r * Math.sin(a), e.center.z ?? 0]);
  }
  emitPolyline(out, xf, pts, false, c);
}

/** ELLIPSE:startAngle/endAngle 为参数角(弧度);长轴向量相对中心,短轴 = Z×长轴×ratio */
function emitEllipse(out: Out, xf: Xf, e: IEllipseEntity, c: RGB): void {
  const { center: ctr, majorAxisEndPoint: ax, axisRatio } = e;
  const bx = -ax.y * axisRatio;
  const by = ax.x * axisRatio;
  const start = e.startAngle ?? 0;
  let sweep = (e.endAngle ?? Math.PI * 2) - start;
  if (sweep <= 0) sweep += Math.PI * 2;
  const segs = Math.max(8, Math.ceil((sweep / (Math.PI * 2)) * FULL_CIRCLE_SEGS));
  const pts: V3[] = [];
  for (let k = 0; k <= segs; k++) {
    const t = start + (sweep * k) / segs;
    pts.push([
      ctr.x + ax.x * Math.cos(t) + bx * Math.sin(t),
      ctr.y + ax.y * Math.cos(t) + by * Math.sin(t),
      ctr.z ?? 0,
    ]);
  }
  emitPolyline(out, xf, pts, false, c);
}

/** SPLINE:de Boor 递推求值按参数采样;文件缺/坏节点向量时用均匀夹持兜底 */
function emitSpline(out: Out, xf: Xf, e: ISplineEntity, c: RGB): void {
  const cp = (e.controlPoints ?? []).filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  const fit = (e.fitPoints ?? []).filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  if (cp.length >= 2) {
    const n = cp.length; // 控制点 0..n-1,有效参数域 [knots[p], knots[n]]
    const p = Math.min(Math.max(e.degreeOfSplineCurve || 3, 1), n - 1);
    let knots = e.knotValues;
    if (!Array.isArray(knots) || knots.length !== n + p + 1) {
      const m = n - p - 1;
      knots = [];
      for (let i = 0; i <= p; i++) knots.push(0);
      for (let i = 1; i <= m; i++) knots.push(i / (m + 1));
      for (let i = 0; i <= p; i++) knots.push(1);
    }
    const t0 = knots[p];
    const t1 = knots[n];
    const samples = Math.min(400, Math.max(16, n * 8));
    const pts: V3[] = [];
    for (let k = 0; k <= samples; k++) {
      const t = t0 + ((t1 - t0) * k) / samples;
      // 找 span s:knots[s] ≤ t < knots[s+1],s ∈ [p, n-1](t=t1 钳到 n-1)
      let s = p;
      while (s < n - 1 && t >= knots[s + 1]) s++;
      const d: V3[] = [];
      for (let j = 0; j <= p; j++) {
        const q = cp[s - p + j];
        d.push([q.x, q.y, q.z ?? 0]);
      }
      for (let r = 1; r <= p; r++) {
        for (let j = p; j >= r; j--) {
          const i0 = s - p + j;
          const denom = knots[i0 + p - r + 1] - knots[i0];
          const alpha = denom > 1e-12 ? (t - knots[i0]) / denom : 0;
          for (let a = 0; a < 3; a++) d[j][a] = d[j - 1][a] * (1 - alpha) + d[j][a] * alpha;
        }
      }
      pts.push(d[p]);
    }
    if (e.closed) pts.push(pts[0]);
    emitPolyline(out, xf, pts, false, c);
  } else if (fit.length >= 2) {
    // 只有拟合点(少见):直接连折线近似
    emitPolyline(out, xf, fit.map(v3), !!e.closed, c);
  }
}

/** INSERT:块实体递归展开;columnCount/rowCount > 1 即 MINSERT 阵列 */
function emitInsert(out: Out, dxf: IDxf, e: IInsertEntity, xf: Xf, depth: number): void {
  if (depth > 16) {
    out.skipped++; // 防块自引用死循环
    return;
  }
  const block = dxf.blocks?.[e.name];
  if (!block?.entities?.length) {
    out.skipped++;
    return;
  }
  const cols = Math.max(1, e.columnCount || 1);
  const rows = Math.max(1, e.rowCount || 1);
  for (let ri = 0; ri < rows; ri++) {
    for (let ci = 0; ci < cols; ci++) {
      const t: IPoint = {
        x: (e.position?.x ?? 0) + (e.columnSpacing || 0) * ci,
        y: (e.position?.y ?? 0) + (e.rowSpacing || 0) * ri,
        z: e.position?.z ?? 0,
      };
      const inner = compose(xf, [e.xScale || 1, e.yScale || 1, e.zScale || 1], e.rotation || 0, t);
      emitEntities(out, dxf, block.entities, inner, depth + 1);
    }
  }
}

function emitEntities(out: Out, dxf: IDxf, entities: IEntity[], xf: Xf, depth: number): void {
  const layers = dxf.tables?.layer?.layers;
  for (const e of entities) {
    if (!e?.type) continue;
    if (e.visible === false || e.inPaperSpace) {
      out.skipped++;
      continue;
    }
    const layer = layers?.[e.layer ?? ""];
    // 图层 off / 冻结:不渲染(AutoCad 语义)
    if (layer && (layer.visible === false || layer.frozen === true)) {
      out.skipped++;
      continue;
    }
    const c = entityColor(e, layer);
    switch (e.type) {
      case "LINE": {
        const vs = (e as ILineEntity).vertices;
        if (vs && vs.length >= 2) pushSeg(out, xf, v3(vs[0]), v3(vs[1]), c);
        break;
      }
      case "LWPOLYLINE":
        emitBulgePolyline(out, xf, (e as ILwpolylineEntity).vertices ?? [], !!(e as ILwpolylineEntity).shape, c);
        break;
      case "POLYLINE": {
        const pe = e as IPolylineEntity;
        if (pe.isPolyfaceMesh || pe.is3dPolygonMesh) {
          out.skipped++; // 网格型 v1 不渲染
          break;
        }
        emitBulgePolyline(out, xf, pe.vertices ?? [], !!pe.shape, c);
        break;
      }
      case "CIRCLE":
        emitArc(out, xf, { ...(e as ICircleEntity), startAngle: 0, endAngle: Math.PI * 2 } as IArcEntity, c);
        break;
      case "ARC":
        emitArc(out, xf, e as IArcEntity, c);
        break;
      case "ELLIPSE":
        emitEllipse(out, xf, e as IEllipseEntity, c);
        break;
      case "SPLINE":
        emitSpline(out, xf, e as ISplineEntity, c);
        break;
      case "3DFACE": {
        const vs = (e as I3DfaceEntity).vertices ?? [];
        if (vs.length >= 3) emitPolyline(out, xf, vs.map(v3), true, c);
        break;
      }
      case "SOLID": {
        // SOLID 四角点绘制次序为 1-2-4-3
        const ps = (e as ISolidEntity).points ?? [];
        if (ps.length === 4) emitPolyline(out, xf, [ps[0], ps[1], ps[3], ps[2]].map(v3), true, c);
        break;
      }
      case "INSERT":
        emitInsert(out, dxf, e as IInsertEntity, xf, depth);
        break;
      default:
        out.skipped++; // TEXT/MTEXT/DIMENSION/HATCH/POINT/ATTDEF… v1 不渲染
        break;
    }
  }
}

export interface DxfModel {
  object: THREE.Object3D;
  /** 未渲染实体数(文字/标注/隐藏图层/未知类型) */
  skipped: number;
}

/** DXF 文本 → 单个 LineSegments(顶点色)。失败抛错(由 ThreeView 转为宫格错误占位)。 */
export function buildDxfObject(text: string): DxfModel {
  if (text.startsWith("AutoCAD Binary DXF"))
    throw new Error("二进制 DXF 暂不支持,请在 CAD 中另存为 ASCII 格式 DXF");
  let dxf: IDxf | null = null;
  try {
    dxf = new DxfParser().parseSync(text);
  } catch {
    // 残缺文件:解析器可能抛错,统一走下方兜底报错
  }
  if (!dxf || !Array.isArray(dxf.entities)) throw new Error("DXF 解析失败(文件可能损坏或为空)");

  const out: Out = { pos: [], col: [], skipped: 0 };
  emitEntities(out, dxf, dxf.entities, IDENTITY, 0);
  if (out.pos.length === 0)
    throw new Error(`DXF 无可渲染的图形实体${out.skipped > 0 ? `(已跳过 ${out.skipped} 个文字/标注/隐藏实体)` : ""}`);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(out.pos, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(out.col, 3));
  const lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ vertexColors: true }));
  lines.name = "dxf";
  return { object: lines, skipped: out.skipped };
}
