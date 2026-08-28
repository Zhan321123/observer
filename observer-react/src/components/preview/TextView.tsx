import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import MarkdownIt from "markdown-it";
import DOMPurify from "dompurify";
import lottie from "lottie-web";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { openUrl } from "@tauri-apps/plugin-opener";
import { readTextFile, fileStat, resolveLink, assetUrl, allowAssetPath } from "../../lib/tauri";
import { docPosGet, docPosSet } from "../../lib/persist";
import { highlight } from "../../lib/highlight";
import { decodeTextBytes, parseDelimited } from "../../lib/decodeText";
import { DataTable, TABLE_MAX_ROWS, TABLE_MAX_COLS } from "./DataTable";
import { clamp, formatBytes } from "../../lib/format";
import { useCellViewStore } from "../../stores/cellViewStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { useGridStore } from "../../stores/gridStore";
import { registerControl } from "../../stores/cellControls";
import { fileRefFromPath } from "../../hooks/useOsDrop";
import type { PreviewProps } from "../../formats/types";

const md = new MarkdownIt({ html: false, linkify: true, breaks: false });

const clampFont = (v: number) => Math.round(clamp(v, 8, 32));

/**
 * 文本 / 代码 / markdown / Lottie 预览(§4.5:滚轮滚动)。
 * - markdown → markdown-it 渲染(默认预览,可切文本);代码 → 零依赖高亮;纯文本 → <pre>。
 * - Lottie(.json 嗅探为 lottie)→ lottie-web 动画(默认)或 JSON 文本,工具条切换。
 * - 增强:行号/自动换行(默认关)、复制全文、Ctrl+滚轮调字号;滚动+字号经 doc_position 持久化。
 * - 大文件:超过设置阈值(textMaxSizeMB,默认 10MB)先提示,确认后才读入显示。
 * - markdown 链接:本地文件 → 新宫格/按覆盖策略打开;http(s) 外链 → 系统浏览器。
 */
export function TextView({ file, cellId, active }: PreviewProps) {
  const [text, setText] = useState<string | null>(null);
  const [fontSize, setFontSize] = useState(13);
  const [lineNumbers, setLineNumbers] = useState(false);
  const [wordWrap, setWordWrap] = useState(false);
  const [mdMode, setMdMode] = useState<"preview" | "text">("preview");
  const [lottieMode, setLottieMode] = useState<"animation" | "text">("animation");
  const [csvMode, setCsvMode] = useState<"table" | "text">("table");
  const [oversize, setOversize] = useState<number | null>(null); // 超阈值字节数(待确认)
  const [confirmed, setConfirmed] = useState(false); // 大文件已确认打开
  const scrollRef = useRef<HTMLDivElement>(null);
  const lottieRef = useRef<HTMLDivElement>(null);
  const animRef = useRef<ReturnType<typeof lottie.loadAnimation> | null>(null); // 点击播放/暂停用
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 卸载时 React 会先置空 scrollRef,故用 posRef 记最新滚动/字号供保存
  const posRef = useRef({ x: 0, y: 0, fontSize: 13 });
  const setView = useCellViewStore((s) => s.setView);
  const textMaxSizeMB = useSettingsStore((s) => s.textMaxSizeMB);
  const placeFile = useGridStore((s) => s.placeFile);

  const isMd = file.kind === "markdown";
  const isLottie = file.sniffed === "lottie";
  const isCsv = file.ext === "csv" || file.ext === "tsv";
  const showMd = isMd && mdMode === "preview";
  const showLottie = isLottie && lottieMode === "animation";
  const showCsvTable = isCsv && csvMode === "table";
  const highlightExt = isMd ? "md" : file.ext;

  // 读文件:先查大小,超阈值且未确认 → 提示;否则读入
  useEffect(() => {
    let cancelled = false;
    setText(null);
    setOversize(null);
    const limit = textMaxSizeMB * 1024 * 1024;
    fileStat(file.path)
      .then((st) => {
        if (cancelled) return;
        if (st.size > limit && !confirmed) {
          setOversize(st.size);
          return undefined;
        }
        // csv/tsv 走 asset:// 字节 + 编码探测(GBK 中文表不乱码);其余走 readTextFile
        const load = isCsv
          ? (async () => {
              await allowAssetPath(file.path).catch(() => {});
              const buf = await fetch(assetUrl(file.path)).then((r) => r.arrayBuffer());
              return decodeTextBytes(buf);
            })()
          : readTextFile(file.path);
        return load.then((t) => {
          if (!cancelled) setText(t);
        });
      })
      .catch((e) => setView(cellId, { error: String(e) }));
    return () => {
      cancelled = true;
    };
  }, [file.path, cellId, setView, textMaxSizeMB, confirmed, isCsv]);

  const html = useMemo(() => {
    if (text == null) return "";
    // markdown 渲染经 DOMPurify 消毒(task.md:渲染不可信内容前必备;md 已 html:false,此为纵深防御)。
    // 代码高亮(highlight)输出已逐 token 转义,无需再消毒。
    return showMd ? DOMPurify.sanitize(md.render(text)) : highlight(text, highlightExt);
  }, [text, showMd, highlightExt]);

  const gutterText = useMemo(() => {
    if (text == null) return "";
    const n = text.split("\n").length;
    let s = "";
    for (let i = 1; i <= n; i++) s += (i === 1 ? "" : "\n") + i;
    return s;
  }, [text]);

  // csv/tsv 表格模式:解析为二维数组(截断显示由 DataTable 上限负责)
  const csvData = useMemo(() => {
    if (!showCsvTable || text == null) return null;
    const all = parseDelimited(text, file.ext === "tsv" ? "\t" : ",");
    const totalRows = all.length;
    const totalCols = all.reduce((m, r) => Math.max(m, r.length), 0);
    const rows = all.slice(0, TABLE_MAX_ROWS).map((r) => r.slice(0, TABLE_MAX_COLS));
    return { rows, totalRows, totalCols };
  }, [showCsvTable, text, file.ext]);

  // Lottie 动画模式:挂载/切换时渲染,卸载/切走时销毁
  useEffect(() => {
    if (!showLottie || text == null) return;
    const container = lottieRef.current;
    if (!container) return;
    let anim: ReturnType<typeof lottie.loadAnimation> | null = null;
    try {
      anim = lottie.loadAnimation({
        container,
        renderer: "svg",
        loop: true,
        autoplay: true,
        animationData: JSON.parse(text),
        // best-fit:svg 撑满容器后按宽高比等比缩放、居中(task.md 交互修正)
        rendererSettings: { preserveAspectRatio: "xMidYMid meet" },
      });
      animRef.current = anim;
    } catch {
      setView(cellId, { error: "Lottie JSON 解析失败" });
    }
    return () => {
      animRef.current = null;
      anim?.destroy();
    };
  }, [showLottie, text, cellId, setView]);

  // 文本载入后恢复上次的滚动位置与字号(doc_position)
  useEffect(() => {
    if (text == null) return;
    let cancelled = false;
    docPosGet(file.path)
      .then((p) => {
        if (cancelled || !p) return;
        if (p.zoom != null) setFontSize(clampFont(p.zoom));
        const el = scrollRef.current;
        if (el) {
          if (p.scroll_y != null) el.scrollTop = p.scroll_y;
          if (p.scroll_x != null) el.scrollLeft = p.scroll_x;
          posRef.current.x = el.scrollLeft;
          posRef.current.y = el.scrollTop;
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [text, file.path]);

  // 持久化:滚动停止 500ms 防抖 + 卸载时
  const persistNow = useCallback(() => {
    const p = posRef.current;
    void docPosSet(file.path, null, p.x, p.y, p.fontSize).catch(() => {});
  }, [file.path]);
  const schedulePersist = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(persistNow, 500);
  }, [persistNow]);
  useEffect(
    () => () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      persistNow();
    },
    [persistNow]
  );

  const onScroll = () => {
    const el = scrollRef.current;
    if (el) {
      posRef.current.x = el.scrollLeft;
      posRef.current.y = el.scrollTop;
    }
    schedulePersist();
  };

  // Ctrl+滚轮调字号(仅选中格;纯滚轮仍正常滚动,§4.5 不变)
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!active || !e.ctrlKey) return;
      e.preventDefault();
      setFontSize((s) => clampFont(s + (e.deltaY < 0 ? 1 : -1)));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [active, text]);

  // 命令式控制(功能条 zoom −/+、行号/换行开关、复制全文、markdown/Lottie 模式切换)
  useEffect(
    () =>
      registerControl(cellId, {
        kind: isMd ? "markdown" : "text",
        zoomText: (delta) => setFontSize((s) => clampFont(s + delta)),
        toggleLineNumbers: () => setLineNumbers((v) => !v),
        toggleWordWrap: () => setWordWrap((v) => !v),
        copyAll: () => {
          if (text != null) void writeText(text).catch(() => {});
        },
        toggleMarkdownMode: () => setMdMode((m) => (m === "preview" ? "text" : "preview")),
        toggleLottieMode: () => setLottieMode((m) => (m === "animation" ? "text" : "animation")),
        toggleCsvMode: () => setCsvMode((m) => (m === "table" ? "text" : "table")),
      }),
    [cellId, isMd, text]
  );

  // 视图态同步(供功能条显示/置灰);字号变化也记入待持久化位置
  useEffect(() => {
    setView(cellId, { fontSize, lineNumbers, wordWrap, mdMode, lottieMode, csvMode });
    posRef.current.fontSize = fontSize;
    schedulePersist();
  }, [fontSize, lineNumbers, wordWrap, mdMode, lottieMode, csvMode, cellId, setView, schedulePersist]);

  // Lottie 动画:点击(已选中时)= 播放/暂停(§4.5,与 dotLottie/Rive/SVGA 一致;
  // 未选中格的点击被 GridCell capture 拦截,不到这里)
  const onLottieClick = () => {
    if (!active) return;
    const a = animRef.current;
    if (!a) return;
    if (a.isPaused) a.play();
    else a.pause();
  };

  // markdown 链接分流:本地文件 → 宫格打开;http(s) 外链 → 系统浏览器
  const onMdClick = (e: React.MouseEvent) => {
    const a = (e.target as HTMLElement).closest("a");
    if (!a) return;
    const href = a.getAttribute("href");
    if (!href) return;
    e.preventDefault();
    if (/^https?:\/\//i.test(href)) {
      void openUrl(href).catch(() => {});
      return;
    }
    void resolveLink(file.path, href).then((abs) => {
      if (!abs) return;
      void fileRefFromPath(abs).then((ref) => placeFile(ref));
    });
  };

  // 大文件确认条(非错误):超阈值且未确认时
  if (text == null) {
    if (oversize != null) {
      return (
        <div className="flex h-full w-full flex-col items-center justify-center gap-3 p-6 text-center">
          <div className="text-sm text-text">
            文件过大({formatBytes(oversize)}),超出文本预览阈值({textMaxSizeMB} MB)
          </div>
          <div className="text-xs text-text-dim">大文件渲染可能卡顿</div>
          <button
            className="rounded bg-brand/30 px-4 py-1.5 text-xs text-brand-bright hover:bg-brand/50"
            onClick={() => setConfirmed(true)}
          >
            仍要打开
          </button>
        </div>
      );
    }
    return (
      <div className="flex h-full w-full items-center justify-center text-text-dim">加载中…</div>
    );
  }

  // csv/tsv 表格模式:独立渲染(DataTable 自带滚动容器 + 文本选择)
  if (showCsvTable && csvData) {
    return <DataTable rows={csvData.rows} totalRows={csvData.totalRows} totalCols={csvData.totalCols} />;
  }

  return (
    <div
      ref={scrollRef}
      onScroll={onScroll}
      className="h-full w-full overflow-auto"
      style={{ userSelect: "text" }}
    >
      {showLottie ? (
        // Lottie 动画模式:best-fit 居中适配宫格(task.md 交互修正)——容器撑满格,
        // svg 经 [&>svg] 强制 100%(lottie-web 默认把 svg 定死为 JSON 的 w/h 像素),
        // 由 viewBox + preserveAspectRatio="xMidYMid meet" 完成等比缩放居中;
        // 点击(已选中时)= 播放/暂停
        <div
          className="flex h-full w-full overflow-hidden p-4"
          style={{ cursor: active ? "pointer" : "default" }}
          onClick={onLottieClick}
        >
          <div ref={lottieRef} className="h-full w-full [&>svg]:h-full [&>svg]:w-full" />
        </div>
      ) : showMd ? (
        // markdown 预览模式(链接点击分流)
        <div
          className="md-body p-4"
          style={{ fontSize }}
          onClick={onMdClick}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : wordWrap ? (
        // 自动换行开:换行显示(此时不提供行号,避免折行错位)
        <pre
          className="m-0 whitespace-pre-wrap break-words p-4 font-mono leading-relaxed"
          style={{ fontSize }}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        // 自动换行关:横向滚动;可选行号 gutter(sticky 吸附左缘)
        <div className="flex min-w-max">
          {lineNumbers && (
            <pre
              aria-hidden
              className="sticky left-0 m-0 select-none bg-panel-2 py-4 pl-4 pr-3 text-right font-mono leading-relaxed text-text-dim/40"
              style={{ fontSize }}
            >
              {gutterText}
            </pre>
          )}
          <pre
            className={`m-0 flex-1 whitespace-pre py-4 font-mono leading-relaxed ${
              lineNumbers ? "pr-4" : "px-4"
            }`}
            style={{ fontSize }}
            dangerouslySetInnerHTML={{ __html: html }}
          />
        </div>
      )}
    </div>
  );
}
