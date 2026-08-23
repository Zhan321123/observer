import { useEffect, useRef, useState } from "react";
import { assetUrl, allowAssetPath } from "../../lib/tauri";
import { useCellViewStore } from "../../stores/cellViewStore";
import { registerControl } from "../../stores/cellControls";
import type { PreviewProps } from "../../formats/types";

interface IcoEntry {
  w: number;
  h: number;
  size: number; // max(w,h),用于排序/默认选最大
  label: string; // "256×256"
  url: string; // blob URL
}

/** DIB(无文件头的 BMP)补 14 字节文件头成完整 BMP;高度字段减半(ico 里为 XOR+AND 双倍高) */
function wrapBmp(dib: Uint8Array): Blob {
  const dv = new DataView(dib.buffer, dib.byteOffset, dib.byteLength);
  const headerSize = dv.getUint32(0, true); // biSize
  const bitCount = dv.getUint16(14, true); // biBitCount
  let clrUsed = dv.getUint32(32, true); // biClrUsed
  if (clrUsed === 0 && bitCount <= 8) clrUsed = 1 << bitCount;
  const pixelOffset = 14 + headerSize + clrUsed * 4;

  const fixed = new Uint8Array(dib); // 拷贝,避免改到原 buffer
  const fdv = new DataView(fixed.buffer);
  fdv.setInt32(8, Math.floor(fdv.getInt32(8, true) / 2), true); // 高度减半

  const head = new Uint8Array(14);
  const bfh = new DataView(head.buffer);
  head[0] = 0x42; // 'B'
  head[1] = 0x4d; // 'M'
  bfh.setUint32(2, 14 + fixed.length, true);
  bfh.setUint32(10, pixelOffset, true);
  return new Blob([head, fixed], { type: "image/bmp" });
}

/** 解析 ICONDIR/ICONDIRENTRY:PNG 直用、BMP(DIB)补头;按尺寸降序,返回 blob URL 列表 */
function parseIco(buf: ArrayBuffer): IcoEntry[] {
  const dv = new DataView(buf);
  const bytes = new Uint8Array(buf);
  if (bytes.length < 6 || dv.getUint16(2, true) !== 1) throw new Error("not ico");
  const count = dv.getUint16(4, true);
  const out: IcoEntry[] = [];
  for (let i = 0; i < count; i++) {
    const base = 6 + i * 16;
    if (base + 16 > bytes.length) break;
    let w = bytes[base];
    let h = bytes[base + 1];
    if (w === 0) w = 256;
    if (h === 0) h = 256;
    const len = dv.getUint32(base + 8, true);
    const off = dv.getUint32(base + 12, true);
    if (off + len > bytes.length) continue;
    const data = bytes.subarray(off, off + len);
    const isPng =
      data.length >= 4 && data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47;
    const blob = isPng ? new Blob([data], { type: "image/png" }) : wrapBmp(data);
    out.push({ w, h, size: Math.max(w, h), label: `${w}×${h}`, url: URL.createObjectURL(blob) });
  }
  out.sort((a, b) => b.size - a.size);
  return out;
}

/**
 * ICO 多尺寸预览(§第二批:ico 查看不同大小)。
 * 解出内嵌各尺寸图,默认显示最大尺寸,工具条下拉切换(读 store.icoSizes/icoIndex)。
 * 字节经 asset:// fetch(铁律 2);透明网格开关生效。
 */
export function IcoView({ file, cellId }: PreviewProps) {
  const setView = useCellViewStore((s) => s.setView);
  const transparencyGrid = useCellViewStore((s) => s.views[cellId]?.transparencyGrid) ?? false;
  const icoIndex = useCellViewStore((s) => s.views[cellId]?.icoIndex) ?? 0;
  const setFullView = useCellViewStore((s) => s.setFullView);
  const setFullScreen = useCellViewStore((s) => s.setFullScreen);

  const [entries, setEntries] = useState<IcoEntry[]>([]);
  const entriesRef = useRef<IcoEntry[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await allowAssetPath(file.path).catch(() => {});
        const buf = await fetch(assetUrl(file.path)).then((r) => r.arrayBuffer());
        const list = parseIco(buf);
        if (cancelled) {
          list.forEach((e) => URL.revokeObjectURL(e.url));
          return;
        }
        if (!list.length) throw new Error("no entries");
        entriesRef.current = list;
        setEntries(list);
        setView(cellId, { icoSizes: list.map((e) => e.label), icoIndex: 0 });
      } catch {
        if (!cancelled) setView(cellId, { error: "ICO 解析失败" });
      }
    })();
    return () => {
      cancelled = true;
      entriesRef.current.forEach((e) => URL.revokeObjectURL(e.url));
      entriesRef.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file.path, cellId]);

  // 命令式控制(功能条尺寸下拉)
  useEffect(
    () =>
      registerControl(cellId, {
        kind: "image",
        setIcoSize: (i) => {
          if (i >= 0 && i < entriesRef.current.length) setView(cellId, { icoIndex: i });
        },
        enterFullView: () => setFullView(cellId),
        enterFullScreen: () => {
          setFullView(cellId);
          setFullScreen(true);
        },
      }),
    [cellId, setView, setFullView, setFullScreen]
  );

  const cur = entries[icoIndex] ?? entries[0];

  return (
    <div
      className={`flex h-full w-full flex-col items-center justify-center gap-2 overflow-hidden ${
        transparencyGrid ? "img-checkerboard" : ""
      }`}
    >
      {cur ? (
        <>
          <img
            src={cur.url}
            alt={file.name}
            draggable={false}
            className="max-h-full max-w-full object-contain"
            style={{ imageRendering: cur.size < 64 ? "pixelated" : "auto" }}
          />
          <div className="text-[11px] text-text-dim">{cur.label}</div>
        </>
      ) : (
        <div className="text-xs text-text-dim">解析中…</div>
      )}
    </div>
  );
}
