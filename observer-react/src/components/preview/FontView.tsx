import { useEffect, useState } from "react";
import { assetUrl, allowAssetPath } from "../../lib/tauri";
import { useCellViewStore } from "../../stores/cellViewStore";
import { registerControl } from "../../stores/cellControls";
import type { PreviewProps } from "../../formats/types";

/** 字号瀑布(样张模式):由大到小,一眼辨型 */
const SIZES = [44, 32, 24, 18, 14];
/** 字形表每页字符数 */
const GLYPHS_PER_PAGE = 96;

/** 字体 family 按格唯一:多格同开不同字体互不污染 */
const familyOf = (cellId: number) => `observer-font-${cellId}`;

/** opentype.js 的 name 表值可能是多语言对象({en:…})也可能是字符串(版本差异),统一取出 */
function locName(v: unknown): string | undefined {
  if (typeof v === "string") return v;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    const en = o["en"];
    if (typeof en === "string" && en) return en;
    const first = Object.values(o).find((x) => typeof x === "string" && x);
    return first as string | undefined;
  }
  return undefined;
}

interface FontMeta {
  family?: string;
  subfamily?: string;
  glyphs?: number;
  version?: string;
}

/** 字符表(96/页小翻页;CJK 字体可达数万字形,全量渲染会卡,裁掉虚拟化/搜索留后续) */
function GlyphGrid({ list, family }: { list: number[]; family: string }) {
  const [pg, setPg] = useState(0);
  const pages = Math.max(1, Math.ceil(list.length / GLYPHS_PER_PAGE));
  const slice = list.slice(pg * GLYPHS_PER_PAGE, (pg + 1) * GLYPHS_PER_PAGE);
  const cols = 12;
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div
        className="grid min-h-0 flex-1 auto-rows-min overflow-auto p-2"
        style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
      >
        {slice.map((cp) => (
          <div
            key={cp}
            title={`U+${cp.toString(16).toUpperCase().padStart(4, "0")}`}
            className="flex aspect-square select-text items-center justify-center border border-line/30 text-text"
            style={{ fontFamily: family, fontSize: 26 }}
          >
            {String.fromCodePoint(cp)}
          </div>
        ))}
      </div>
      <div className="flex shrink-0 items-center gap-2 border-t border-line/40 bg-panel-2/60 px-3 py-1.5 text-[11px] text-text-dim">
        <button
          className="rounded px-2 py-0.5 hover:bg-panel disabled:opacity-40"
          disabled={pg === 0}
          onClick={() => setPg((p) => Math.max(0, p - 1))}
        >
          ‹
        </button>
        <span className="tabular-nums">
          {pg + 1} / {pages} 页 · {list.length.toLocaleString()} 字符
        </span>
        <button
          className="rounded px-2 py-0.5 hover:bg-panel disabled:opacity-40"
          disabled={pg >= pages - 1}
          onClick={() => setPg((p) => Math.min(pages - 1, p + 1))}
        >
          ›
        </button>
      </div>
    </div>
  );
}

/**
 * 字体预览(task2 二)。两路并行:
 * ① FontFace 样张 + 试字输入(ttf/otf/woff/woff2 原生支持;ttc 取首个,尽力而为);
 * ② opentype.js 元数据 + 字形表(仅 ttf/otf/woff;woff2 无 brotli、ttc 集合解不了 → 降级提示)。
 * 生命周期:cleanup 持原 FontFace 引用 delete(按对象不按 family);先 load 成功再 add。
 */
export function FontView({ file, cellId, active }: PreviewProps) {
  const setView = useCellViewStore((s) => s.setView);
  const fontMode = useCellViewStore((s) => s.views[cellId]?.fontMode) ?? "specimen";
  const fontText = useCellViewStore((s) => s.views[cellId]?.fontText);
  const [family, setFamily] = useState<string | null>(null);
  const [meta, setMeta] = useState<FontMeta | null>(null);
  const [glyphs, setGlyphs] = useState<number[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    let face: FontFace | null = null;
    setFamily(null);
    setMeta(null);
    setGlyphs(null);
    (async () => {
      await allowAssetPath(file.path).catch(() => {});
      const buf = await fetch(assetUrl(file.path)).then((r) => r.arrayBuffer());
      if (cancelled) return;
      // ① FontFace 样张(woff2/ttc 浏览器原生支持;ttc 只激活首个字体)
      face = new FontFace(familyOf(cellId), buf);
      await face.load();
      if (cancelled) return;
      document.fonts.add(face);
      setFamily(familyOf(cellId));
      // ② opentype 元数据/字形表;失败 = woff2/ttc → 降级(仅无元数据与字形表,样张不受影响)
      try {
        const opentype = await import("opentype.js");
        const font = opentype.parse(buf.slice(0)); // 防御性拷贝(FontFace 规范上会拷贝数据)
        const n = font.names as unknown as Record<string, unknown>;
        const map = (font.tables as unknown as { cmap?: { glyphIndexMap?: Record<string, number> } }).cmap
          ?.glyphIndexMap;
        setMeta({
          family: locName(n["fontFamily"]),
          subfamily: locName(n["fontSubfamily"]),
          glyphs: font.numGlyphs,
          version: locName(n["version"]),
        });
        if (map) setGlyphs(Object.keys(map).map(Number).sort((a, b) => a - b));
      } catch {
        /* 降级:元数据/字形表不可用(woff2/ttc) */
      }
    })().catch(() => {
      if (!cancelled) setView(cellId, { error: "字体解析失败(文件损坏或格式异常)" });
    });
    return () => {
      cancelled = true;
      if (face) document.fonts.delete(face);
    };
  }, [file.path, cellId, setView]);

  // 命令式控制:样张/字形表视角切换
  useEffect(
    () =>
      registerControl(cellId, {
        kind: "font",
        toggleFontMode: () => {
          const cur = useCellViewStore.getState().views[cellId]?.fontMode;
          setView(cellId, { fontMode: cur === "glyphs" ? "specimen" : "glyphs" });
        },
      }),
    [cellId, setView]
  );

  // 试字文本:默认文件名去扩展名(字体自己展示自己的名字)
  const text = fontText ?? file.name.replace(/\.[^.]+$/, "");

  if (fontMode === "glyphs") {
    if (!family) return <div className="p-4 text-xs text-text-dim">解析中…</div>;
    if (!glyphs) {
      return (
        <div className="p-4 text-xs text-text-dim">
          字形表不支持此格式({file.ext.toUpperCase()};woff2/ttc 暂无解包链),样张不受影响
        </div>
      );
    }
    return <GlyphGrid list={glyphs} family={family} />;
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* 试字输入(仅选中格;实时改样张) */}
      {active && (
        <div className="flex shrink-0 items-center gap-2 border-b border-line/40 bg-panel-2/60 px-3 py-2">
          <span className="shrink-0 text-[11px] text-text-dim">试字</span>
          <input
            value={text}
            onChange={(e) => setView(cellId, { fontText: e.target.value })}
            placeholder="输入预览文字"
            className="w-full rounded bg-panel px-2 py-0.5 text-xs text-text outline-none"
            // 输入框自身不用预览字体,保持可读
          />
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
        {SIZES.map((s) => (
          <div
            key={s}
            className="truncate text-text"
            style={{ fontFamily: family ?? undefined, fontSize: s, lineHeight: 1.5 }}
          >
            {family ? text : "加载中…"}
          </div>
        ))}
      </div>
      {/* 元数据底栏 */}
      <div className="flex shrink-0 flex-wrap gap-x-4 gap-y-0.5 border-t border-line/40 bg-panel-2/60 px-3 py-1.5 text-[11px] text-text-dim">
        <span className="text-text">{meta?.family ?? file.name}</span>
        {meta?.subfamily && <span>{meta.subfamily}</span>}
        {meta?.glyphs != null && <span>{meta.glyphs.toLocaleString()} 字形</span>}
        {meta?.version && <span>{meta.version}</span>}
        <span className="uppercase">{file.ext}</span>
        {file.ext === "ttc" && <span>字体集合(仅首个)</span>}
      </div>
    </div>
  );
}
