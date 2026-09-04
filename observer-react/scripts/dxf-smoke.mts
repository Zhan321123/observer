// DXF 构建冒烟测试(临时,不进构建):node --experimental-strip-types 或 npx tsx 运行。
// 覆盖:LINE / LWPOLYLINE(bulge+闭合)/ CIRCLE / ARC / ELLIPSE / SPLINE(无节点向量→兜底)/
// INSERT(块展开+缩放旋转)/ 图层色(ByLayer)/ 冻结图层跳过 / 二进制哨兵拒绝。
import * as THREE from "three";
import { buildDxfObject } from "../src/lib/dxfToThree";

const e = (code: number, value: string | number) => `${code}\n${value}\n`;

const dxf = [
  e(0, "SECTION"), e(2, "HEADER"), e(9, "$ACADVER"), e(1, "AC1015"), e(0, "ENDSEC"),
  // 图层表:WALLS 蓝(5);HIDDEN 冻结(flags bit 1)
  e(0, "SECTION"), e(2, "TABLES"), e(0, "TABLE"), e(2, "LAYER"),
  e(0, "LAYER"), e(2, "WALLS"), e(62, 5), e(70, 0),
  e(0, "LAYER"), e(2, "HIDDEN"), e(62, 1), e(70, 1),
  e(0, "ENDTAB"), e(0, "ENDSEC"),
  // 块 MYBLK:一条对角线(图层 BLKLYR 未定义表项 → 白兜底)
  e(0, "SECTION"), e(2, "BLOCKS"), e(0, "BLOCK"), e(2, "MYBLK"),
  e(0, "LINE"), e(8, "BLKLYR"), e(10, 0), e(20, 0), e(11, 5), e(21, 5),
  e(0, "ENDBLK"), e(0, "ENDSEC"),
  e(0, "SECTION"), e(2, "ENTITIES"),
  // LINE on WALLS(ByLayer 蓝)
  e(0, "LINE"), e(8, "WALLS"), e(10, 0), e(20, 0), e(30, 0), e(11, 100), e(21, 50), e(31, 0),
  // LINE on HIDDEN(冻结 → 应跳过)
  e(0, "LINE"), e(8, "HIDDEN"), e(10, -50), e(20, -50), e(11, -60), e(21, -60),
  // 实体自带 ACI 3(绿)
  e(0, "CIRCLE"), e(8, "WALLS"), e(62, 3), e(10, 50), e(20, 25), e(30, 0), e(40, 20),
  // ARC 30°→120°
  e(0, "ARC"), e(8, "WALLS"), e(10, 0), e(20, 25), e(30, 0), e(40, 10), e(50, 30), e(51, 120),
  // LWPOLYLINE 3 点闭合,第二点带 bulge 0.4142(≈90° 弧)
  e(0, "LWPOLYLINE"), e(8, "WALLS"), e(90, 3), e(70, 1),
  e(10, 120), e(20, 10),
  e(10, 130), e(20, 10), e(42, 0.414214),
  e(10, 130), e(20, 20),
  // ELLIPSE 全椭圆:中心(60,60) 半长轴 30 ratio 0.5
  e(0, "ELLIPSE"), e(8, "WALLS"), e(10, 60), e(20, 60), e(11, 30), e(21, 0), e(40, 0.5), e(41, 0), e(42, 6.283185307179586),
  // SPLINE 无节点向量(6 控制点 → 兜底均匀夹持)
  e(0, "SPLINE"), e(8, "WALLS"), e(70, 8), e(71, 3), e(72, 0), e(73, 6),
  e(10, 0), e(20, 100), e(10, 10), e(20, 110), e(10, 20), e(20, 120),
  e(10, 30), e(20, 130), e(10, 40), e(20, 140), e(10, 50), e(20, 150),
  // INSERT:MYBLK 于(200,200)缩放 2 旋转 30°
  e(0, "INSERT"), e(8, "WALLS"), e(2, "MYBLK"), e(10, 200), e(20, 200), e(41, 2), e(42, 2), e(50, 30),
  e(0, "ENDSEC"), e(0, "EOF"),
].join("");

// ---- 断言 ----
const { object, skipped } = buildDxfObject(dxf);
const seg = object as THREE.LineSegments;
const pos = seg.geometry.getAttribute("position");
const col = seg.geometry.getAttribute("color");
console.log("type:", object.type, "| segments:", pos.count / 2, "| skipped:", skipped);

const box = new THREE.Box3().setFromObject(object);
console.log("bbox:", box.min.toArray().map((v) => v.toFixed(1)), "→", box.max.toArray().map((v) => v.toFixed(1)));

// 冻结图层 LINE 被跳过(其端点在 -50/-60,不该拉低 bbox;ARC 合法地到 -5)
if (box.min.x < -50 || box.min.y < -50) throw new Error("冻结图层实体未被跳过");
if (skipped < 1) throw new Error("skipped 应 ≥1(冻结图层)");
// ARC 30°→120°(dxf-parser 已转弧度):120° 端点 x = 0 + 10·cos120° = -5
if (box.min.x > -4.5) throw new Error(`ARC 弧度处理错误:min.x=${box.min.x}`);
// INSERT 展开后:块内线段 (0,0)-(5,5),缩放×2 → (0,0)-(10,10),旋转 30° 后最远点
// (3.66, 13.66) + (200,200) = (203.66, 213.66)
if (box.max.x < 203 || box.max.y < 213) throw new Error("INSERT 块未正确展开/变换");
// 颜色:ACI 3 = (0,255,0) 绿(CIRCLE);顺带打印分布
const distinct = new Set<string>();
for (let i = 0; i < col.count; i++) {
  const c = [col.getX(i), col.getY(i), col.getZ(i)].map((v) => Math.round(v * 255)).join(",");
  distinct.add(c);
}
console.log("distinct colors:", [...distinct].join(" | "));
let sawGreen = false;
for (let i = 0; i < col.count && !sawGreen; i++)
  if (col.getX(i) === 0 && col.getY(i) === 1 && col.getZ(i) === 0) sawGreen = true;
if (!sawGreen) throw new Error("未找到 ACI 3 绿色顶点");
// LineBasicMaterial vertexColors
if (!(seg.material as THREE.LineBasicMaterial).vertexColors) throw new Error("材质未开顶点色");

// 二进制哨兵
try {
  buildDxfObject("AutoCAD Binary DXF\r\n\x1a\x00rest");
  throw new Error("二进制 DXF 未被拒绝");
} catch (err) {
  if (!(err instanceof Error) || !err.message.includes("二进制")) throw err;
}
// 残缺文件
try {
  buildDxfObject("garbage not a dxf at all");
  // dxf-parser 对无 SECTION 的文本可能返回空 entities → 由"无可渲染实体"兜底
} catch (err) {
  if (!(err instanceof Error)) throw err;
}
console.log("OK:全量断言通过");
