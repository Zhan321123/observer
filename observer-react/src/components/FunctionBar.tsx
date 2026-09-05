import {
  Play, Pause, Volume2, VolumeX, SkipBack, SkipForward, ChevronLeft, ChevronRight,
  Maximize, Expand, Minimize2, ZoomIn, ZoomOut, FolderOpen, Copy, Ratio, Scan,
  ListOrdered, WrapText, ClipboardCopy, Eye, FileCode, Film, LayoutGrid, Table,
  RotateCcw, Orbit, Box, Grid3x3, Lightbulb, FolderArchive, ChevronsUpDown, ChevronsDownUp,
  Type, FileText, FileTerminal,
} from "lucide-react";
import { useGridStore } from "../stores/gridStore";
import { useCellViewStore } from "../stores/cellViewStore";
import { useSettingsStore } from "../stores/settingsStore";
import { getControl } from "../stores/cellControls";
import { revealInExplorer, copyPath } from "../lib/tauri";
import { formatTime } from "../lib/format";

function BarButton({
  title, onClick, disabled, children, active,
}: {
  title: string;
  onClick?: () => void;
  disabled?: boolean;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={`flex h-7 w-7 items-center justify-center rounded disabled:opacity-30 ${
        active ? "bg-brand/30 text-brand-bright" : "text-text-dim hover:bg-panel-2 hover:text-text"
      }`}
    >
      {children}
    </button>
  );
}

const Sep = () => <div className="mx-1 h-5 w-px bg-line" />;

/**
 * 功能 frame(§5):对选中格操作,按文件类型动态切换按钮组。
 * 无选中格时显示"未选择文件"并禁用全部。通用操作(资源管理器显示/复制路径)恒在。
 *
 * 覆盖层悬浮形态(task.md 交互修正):全界面/全屏时 FullViewOverlay 以 `floating + cellId +
 * onExit` 复用本组件——对当前全屏格操作,"全界面/全屏"进入按钮换成"退出"(等效 Esc)。
 */
export function FunctionBar({
  cellId,
  floating,
  onExit,
}: {
  /** 目标格(覆盖层悬浮条传全屏格);缺省 = 选中格 */
  cellId?: number | null;
  /** 悬浮形态:圆角 + 边框 + 阴影(无 border-t) */
  floating?: boolean;
  /** 存在时(覆盖层模式):以"退出"按钮替代"全界面/全屏"进入按钮 */
  onExit?: () => void;
}) {
  const selected = useGridStore((s) => s.selected);
  const target = cellId ?? selected;
  const cell = useGridStore((s) => (target != null ? s.cells[target] : null));
  const view = useCellViewStore((s) => (target != null ? s.views[target] : undefined));

  const file = cell?.file ?? null;
  const kind = file?.kind;
  // 事件时取控制:cellControls 是普通 Map(非响应式),渲染期快照会拿到过期的死闭包
  // (xlsx 异步解析完成后重注册,快照仍指向 wb=null 的旧控制 → 切 sheet 无反应)。
  const ctl = () => getControl(target);

  const isMedia = kind === "video" || kind === "audio";
  const isImage = kind === "image";
  const isText = kind === "text" || kind === "markdown";
  const isSpreadsheet = kind === "spreadsheet";
  const isPdf = kind === "pdf";
  const isThreed = kind === "threed";
  const isAnim = kind === "anim";
  const isGif = file?.ext === "gif";
  const isIco = file?.ext === "ico";
  const isSvg = file?.ext === "svg" || file?.ext === "svgz";
  const isCsv = file?.ext === "csv" || file?.ext === "tsv";
  const isLottie = file?.sniffed === "lottie";
  // 双身份压缩容器(task2 §5):xlsx/xlsm/ods 本质是 zip → 功能条出"压缩包目录/表格"切换
  const isZipSheet = isSpreadsheet && ["xlsx", "xlsm", "ods"].includes(file?.ext ?? "");
  const xlsxArchive = isSpreadsheet && view?.xlsxMode === "archive";
  // task2 二:文档(docx/pptx,zip 容器)双身份 + 字体/SQLite
  const isDocument = kind === "document";
  const docArchive = isDocument && view?.docMode === "archive";
  const isFont = kind === "font";
  const isSqlite = kind === "sqlite";
  // 压缩包目录树(纯 archive 或 xlsx/docx 双身份的压缩包视角):功能条出"全部展开/全部闭合"
  const isArchiveTree = kind === "archive" || xlsxArchive || (isDocument && view?.docMode === "archive");
  // 可含透明层的图片(显示"透明网格"开关);gif/ico 也支持
  const alphaImage =
    isImage && ["png", "webp", "gif", "avif", "svg", "ico", "tiff", "tif", "tga"].includes(file?.ext ?? "");

  const playing = view?.playing ?? false;
  const currentTime = view?.currentTime ?? 0;
  const duration = view?.duration ?? 0;
  const volume = view?.volume ?? 1;
  const rate = view?.rate ?? 1;
  const scale = view?.scale ?? 1;
  const fitMode = view?.fitMode;
  // 文本字号兜底 = 设置的默认字号(§新增;TextView 未上报时,如 markdown 首帧)
  const textDefaultFontSize = useSettingsStore((s) => s.textDefaultFontSize);
  // SQLite 分页区间(SqliteView PAGE_SIZE=100;仅显示用)
  const sqTotal = view?.sqliteTotal ?? 0;
  const sqOffset = view?.sqliteOffset ?? 0;
  const sqFrom = sqTotal === 0 ? 0 : sqOffset + 1;
  const sqTo = Math.min(sqOffset + 100, sqTotal);

  return (
    <div
      className={`flex h-11 shrink-0 items-center gap-1 overflow-x-auto px-2 ${
        floating ? "rounded-lg border border-line bg-panel shadow-2xl" : "border-t border-line bg-panel"
      }`}
    >
      {!file ? (
        <span className="px-2 text-xs text-text-dim">未选择文件</span>
      ) : (
        <>
          {/* 图片组(ico 走专用尺寸下拉;普通图片与 gif 走缩放/适配,gif 帧控件在上一组) */}
          {isImage && isGif && (
            <>
              <BarButton
                title={view?.gifPlaying ? "暂停" : "播放"}
                onClick={() => ctl()?.gifTogglePlay?.()}
              >
                {view?.gifPlaying ? <Pause size={16} /> : <Play size={16} />}
              </BarButton>
              <BarButton title="上一帧" onClick={() => ctl()?.gifStep?.(-1)}>
                <ChevronLeft size={16} />
              </BarButton>
              <BarButton title="下一帧" onClick={() => ctl()?.gifStep?.(1)}>
                <ChevronRight size={16} />
              </BarButton>
              <span className="shrink-0 text-[11px] tabular-nums text-text-dim">
                {String((view?.gifFrame ?? 0) + 1).padStart(String(view?.gifFrameCount ?? 0).length, "0")} / {view?.gifFrameCount ?? 0} 帧
              </span>
            </>
          )}
          {isImage && isIco && (
            <>
              <select
                className="rounded bg-panel-2 px-1 text-[11px] text-text outline-none"
                value={view?.icoIndex ?? 0}
                onChange={(e) => ctl()?.setIcoSize?.(Number(e.target.value))}
                title="选择内嵌尺寸"
              >
                {(view?.icoSizes ?? []).map((s, i) => (
                  <option key={i} value={i}>
                    {s}
                  </option>
                ))}
              </select>
            </>
          )}
          {isImage && !isIco && (
            <>
              <BarButton title="最佳显示(适应宫格)" active={fitMode === "best-fit"} onClick={() => ctl()?.setFitMode?.("best-fit")}>
                <Ratio size={16} />
              </BarButton>
              <BarButton title="1:1(实际像素)" active={fitMode === "actual"} onClick={() => ctl()?.setFitMode?.("actual")}>
                <Scan size={16} />
              </BarButton>
              <BarButton title="缩小" onClick={() => ctl()?.zoomOut?.()}>
                <ZoomOut size={16} />
              </BarButton>
              <input
                type="range"
                className="h-1 w-24 accent-brand-bright"
                min={0.02}
                max={8}
                step={0.01}
                value={Math.min(scale, 8)}
                onChange={(e) => ctl()?.setZoom?.(Number(e.target.value))}
                title={`缩放 ${Math.round(scale * 100)}%`}
              />
              <BarButton title="放大" onClick={() => ctl()?.zoomIn?.()}>
                <ZoomIn size={16} />
              </BarButton>
              <span className="w-10 text-[11px] tabular-nums text-text-dim">{Math.round(scale * 100)}%</span>
            </>
          )}
          {/* svg:预览 / 文本源码 */}
          {isImage && isSvg && (
            <BarButton
              title={view?.svgMode === "text" ? "切换到预览" : "切换到源码"}
              active={view?.svgMode !== "text"}
              onClick={() => ctl()?.toggleSvgMode?.()}
            >
              {view?.svgMode === "text" ? <Eye size={16} /> : <FileCode size={16} />}
            </BarButton>
          )}
          {/* 透明图层 → 棋盘格底开关 */}
          {alphaImage && (
            <BarButton
              title="透明网格(棋盘格底)"
              active={view?.transparencyGrid ?? false}
              onClick={() => ctl()?.toggleTransparencyGrid?.()}
            >
              <LayoutGrid size={16} />
            </BarButton>
          )}

          {/* 媒体组(视频/音频) */}
          {isMedia && (
            <>
              <BarButton title={playing ? "暂停" : "播放"} onClick={() => ctl()?.toggle?.()}>
                {playing ? <Pause size={16} /> : <Play size={16} />}
              </BarButton>
              <BarButton title="快退 5s" onClick={() => ctl()?.seek?.(currentTime - 5)}>
                <SkipBack size={16} />
              </BarButton>
              <BarButton title="快进 5s" onClick={() => ctl()?.seek?.(currentTime + 5)}>
                <SkipForward size={16} />
              </BarButton>
              {kind === "video" && (
                <>
                  <BarButton title="上一帧" onClick={() => ctl()?.stepFrame?.(-1)}>
                    <ChevronLeft size={16} />
                  </BarButton>
                  <BarButton title="下一帧" onClick={() => ctl()?.stepFrame?.(1)}>
                    <ChevronRight size={16} />
                  </BarButton>
                </>
              )}
              <input
                type="range"
                className="h-1 min-w-24 flex-1 accent-brand-bright"
                min={0}
                max={duration || 0}
                step={0.01}
                value={currentTime}
                onChange={(e) => ctl()?.seek?.(Number(e.target.value))}
                title="播放进度"
              />
              <span className="shrink-0 text-[11px] tabular-nums text-text-dim">
                {formatTime(currentTime)} / {formatTime(duration)}
              </span>
              {/* 音频:宫格主体显示模式(实时频谱柱形图默认/滚动波形/无,§交互升级) */}
              {kind === "audio" && (
                <select
                  className="rounded bg-panel-2 px-1 text-[11px] text-text outline-none"
                  value={view?.audioDisplay ?? "bars"}
                  onChange={(e) =>
                    ctl()?.setAudioDisplay?.(e.target.value as "bars" | "wave" | "none")
                  }
                  title="音频显示模式"
                >
                  <option value="bars">频谱图</option>
                  <option value="wave">滚动波形</option>
                  <option value="none">无</option>
                </select>
              )}
              <BarButton title={volume === 0 ? "取消静音" : "静音"} onClick={() => ctl()?.setVolume?.(volume === 0 ? 1 : 0)}>
                {volume === 0 ? <VolumeX size={16} /> : <Volume2 size={16} />}
              </BarButton>
              <input
                type="range"
                className="h-1 w-16 accent-brand-bright"
                min={0}
                max={1}
                step={0.01}
                value={volume}
                onChange={(e) => ctl()?.setVolume?.(Number(e.target.value))}
                title="音量"
              />
              <select
                className="rounded bg-panel-2 px-1 text-[11px] text-text outline-none"
                value={rate}
                onChange={(e) => ctl()?.setRate?.(Number(e.target.value))}
                title="播放速度"
              >
                {[0.25, 0.5, 0.75, 1, 1.25, 1.5, 2].map((r) => (
                  <option key={r} value={r}>{r}×</option>
                ))}
              </select>
              {kind === "video" && (
                <>
                  <Sep />
                  <BarButton title="最佳显示" active={fitMode === "best-fit"} onClick={() => ctl()?.setFitMode?.("best-fit")}>
                    <Ratio size={16} />
                  </BarButton>
                  <BarButton title="1:1" active={fitMode === "actual"} onClick={() => ctl()?.setFitMode?.("actual")}>
                    <Scan size={16} />
                  </BarButton>
                </>
              )}
            </>
          )}

          {/* 文本组 */}
          {isText && (
            <>
              {/* markdown:预览 / 文本 */}
              {kind === "markdown" && (
                <BarButton
                  title={view?.mdMode === "text" ? "切换到预览" : "切换到源码"}
                  active={view?.mdMode !== "text"}
                  onClick={() => ctl()?.toggleMarkdownMode?.()}
                >
                  {view?.mdMode === "text" ? <Eye size={16} /> : <FileCode size={16} />}
                </BarButton>
              )}
              {/* lottie(.json):动画 / 文本;兼容模式徽标(表达式失败自动剥除后重载) */}
              {isLottie && (
                <>
                  <BarButton
                    title={view?.lottieMode === "text" ? "切换到动画" : "切换到文本"}
                    active={view?.lottieMode !== "text"}
                    onClick={() => ctl()?.toggleLottieMode?.()}
                  >
                    {view?.lottieMode === "text" ? <Film size={16} /> : <FileCode size={16} />}
                  </BarButton>
                  {view?.lottieCompat && (
                    <span
                      className="shrink-0 rounded bg-amber-500/20 px-1.5 text-[10px] leading-5 text-amber-400"
                      title="表达式渲染失败,已禁用表达式后以兼容模式重载(丢失回弹等次级动效)"
                    >
                      兼容模式
                    </span>
                  )}
                </>
              )}
              {/* csv/tsv:表格 / 文本源码 */}
              {isCsv && (
                <BarButton
                  title={view?.csvMode === "text" ? "切换到表格" : "切换到源码"}
                  active={view?.csvMode !== "text"}
                  onClick={() => ctl()?.toggleCsvMode?.()}
                >
                  {view?.csvMode === "text" ? <Table size={16} /> : <FileCode size={16} />}
                </BarButton>
              )}
              <BarButton title="缩小字号" onClick={() => ctl()?.zoomText?.(-1)}>
                <ZoomOut size={16} />
              </BarButton>
              <span className="w-8 text-center text-[11px] tabular-nums text-text-dim">
                {view?.fontSize ?? textDefaultFontSize}
              </span>
              <BarButton title="放大字号" onClick={() => ctl()?.zoomText?.(1)}>
                <ZoomIn size={16} />
              </BarButton>
              {kind === "text" && (
                <>
                  <BarButton
                    title="行号"
                    active={view?.lineNumbers ?? false}
                    onClick={() => ctl()?.toggleLineNumbers?.()}
                  >
                    <ListOrdered size={16} />
                  </BarButton>
                  <BarButton
                    title="自动换行"
                    active={view?.wordWrap ?? false}
                    onClick={() => ctl()?.toggleWordWrap?.()}
                  >
                    <WrapText size={16} />
                  </BarButton>
                </>
              )}
              <BarButton title="复制全文" onClick={() => ctl()?.copyAll?.()}>
                <ClipboardCopy size={16} />
              </BarButton>
            </>
          )}

          {/* 表格组(xlsx):sheet 下拉(压缩包目录视角下隐藏)+ 双身份切换(task2 §5) */}
          {isSpreadsheet && (
            <>
              {!xlsxArchive && (
                <>
                  <span className="shrink-0 text-[11px] text-text-dim">工作表</span>
                  <select
                    className="max-w-40 rounded bg-panel-2 px-1 text-[11px] text-text outline-none"
                    value={view?.sheetIndex ?? 0}
                    onChange={(e) => ctl()?.setSheet?.(Number(e.target.value))}
                    title="选择工作表"
                  >
                    {(view?.sheetNames ?? []).map((s, i) => (
                      <option key={i} value={i}>
                        {s}
                      </option>
                    ))}
                  </select>
                </>
              )}
              {/* xlsx 双身份:压缩包目录 / 表格预览(zip 容器限定) */}
              {isZipSheet && (
                <BarButton
                  title={xlsxArchive ? "切换到表格预览" : "以压缩包目录查看(zip 容器)"}
                  active={!xlsxArchive}
                  onClick={() => ctl()?.toggleXlsxMode?.()}
                >
                  {xlsxArchive ? <Table size={16} /> : <FolderArchive size={16} />}
                </BarButton>
              )}
            </>
          )}

          {/* 文档组(task2 二):docx/pptx 均为 zip 容器 → 文档/压缩包目录双身份(循 xlsx 先例) */}
          {isDocument && (
            <BarButton
              title={docArchive ? "切换到文档预览" : "以压缩包目录查看(zip 容器)"}
              active={!docArchive}
              onClick={() => ctl()?.toggleDocMode?.()}
            >
              {docArchive ? <FileText size={16} /> : <FolderArchive size={16} />}
            </BarButton>
          )}

          {/* SQLite 组(task2 二):表下拉 + 翻页 + 结构(DDL)面板 */}
          {isSqlite && (
            <>
              <span className="shrink-0 text-[11px] text-text-dim">表</span>
              <select
                className="max-w-40 rounded bg-panel-2 px-1 text-[11px] text-text outline-none"
                value={view?.sqliteTableIndex ?? 0}
                onChange={(e) => ctl()?.setSqliteTable?.(Number(e.target.value))}
                title="选择表 / 视图"
              >
                {(view?.sqliteTables ?? []).map((t, i) => (
                  <option key={i} value={i}>
                    {t.kind === "view" ? `${t.name}(视图)` : t.name}
                  </option>
                ))}
              </select>
              <BarButton title="上一页" onClick={() => ctl()?.sqlitePageStep?.(-1)}>
                <ChevronLeft size={16} />
              </BarButton>
              <span className="shrink-0 text-[11px] tabular-nums text-text-dim">
                {sqFrom}–{sqTo} / {sqTotal.toLocaleString()}
              </span>
              <BarButton title="下一页" onClick={() => ctl()?.sqlitePageStep?.(1)}>
                <ChevronRight size={16} />
              </BarButton>
              <BarButton
                title="表结构(DDL)"
                active={view?.sqliteShowSchema}
                onClick={() => ctl()?.toggleSchema?.()}
              >
                <FileTerminal size={16} />
              </BarButton>
            </>
          )}

          {/* 字体组(task2 二):样张 / 字形表切换 */}
          {isFont && (
            <BarButton
              title={view?.fontMode === "glyphs" ? "切换到样张" : "查看字形表"}
              active={view?.fontMode !== "glyphs"}
              onClick={() => ctl()?.toggleFontMode?.()}
            >
              {view?.fontMode === "glyphs" ? <Type size={16} /> : <Grid3x3 size={16} />}
            </BarButton>
          )}

          {/* 压缩包目录树组:全部展开 / 全部闭合(包内树纯内存无 IO;xlsx 双身份视角同享) */}
          {isArchiveTree && (
            <>
              <BarButton title="全部展开" onClick={() => ctl()?.archiveExpandAll?.()}>
                <ChevronsUpDown size={16} />
              </BarButton>
              <BarButton title="全部闭合" onClick={() => ctl()?.archiveCollapseAll?.()}>
                <ChevronsDownUp size={16} />
              </BarButton>
            </>
          )}

          {/* PDF 组:翻页 + 缩放 */}
          {isPdf && (
            <>
              <BarButton title="上一页" onClick={() => ctl()?.pdfStep?.(-1)}>
                <ChevronLeft size={16} />
              </BarButton>
              <span className="shrink-0 text-[11px] tabular-nums text-text-dim">
                {String((view?.pdfPage ?? 0) + 1).padStart(String(view?.pdfPageCount ?? 0).length, "0")} / {view?.pdfPageCount ?? 0} 页
              </span>
              <BarButton title="下一页" onClick={() => ctl()?.pdfStep?.(1)}>
                <ChevronRight size={16} />
              </BarButton>
              <BarButton title="缩小" onClick={() => ctl()?.zoomOut?.()}>
                <ZoomOut size={16} />
              </BarButton>
              <span className="w-10 text-[11px] tabular-nums text-text-dim">{Math.round((view?.pdfScale ?? 1) * 100)}%</span>
              <BarButton title="放大" onClick={() => ctl()?.zoomIn?.()}>
                <ZoomIn size={16} />
              </BarButton>
            </>
          )}

          {/* 3D 组(§5):重置视角 / 自动旋转 / 线框 / 平面网格 / 光照环境 */}
          {isThreed && (
            <>
              <BarButton title="重置视角" onClick={() => ctl()?.threedReset?.()}>
                <RotateCcw size={16} />
              </BarButton>
              <BarButton
                title="自动旋转"
                active={view?.threedAutoRotate ?? false}
                onClick={() => ctl()?.toggleThreedAutoRotate?.()}
              >
                <Orbit size={16} />
              </BarButton>
              <BarButton
                title="线框模式"
                active={view?.threedWireframe ?? false}
                onClick={() => ctl()?.toggleThreedWireframe?.()}
              >
                <Box size={16} />
              </BarButton>
              <BarButton
                title="平面网格"
                active={view?.threedGrid ?? true}
                onClick={() => ctl()?.toggleThreedGrid?.()}
              >
                <Grid3x3 size={16} />
              </BarButton>
              <BarButton title="光照环境切换" onClick={() => ctl()?.cycleThreedLight?.()}>
                <Lightbulb size={16} />
              </BarButton>
            </>
          )}

          {/* 动效组(dotLottie/Rive/SVGA):播放/暂停 */}
          {isAnim && (
            <BarButton title={playing ? "暂停" : "播放"} onClick={() => ctl()?.toggle?.()}>
              {playing ? <Pause size={16} /> : <Play size={16} />}
            </BarButton>
          )}

          {/* 覆盖层悬浮条:退出按钮(等效 Esc);普通形态:全界面 / 全屏(图片 / 视频 / PDF / 3D,§4.6) */}
          {onExit ? (
            <>
              <Sep />
              <BarButton title="退出全界面/全屏(Esc)" onClick={onExit}>
                <Minimize2 size={16} />
              </BarButton>
            </>
          ) : (isImage || kind === "video" || isPdf || isThreed || isDocument) ? (
            <>
              <Sep />
              <BarButton title="全界面显示(Esc 退出)" onClick={() => ctl()?.enterFullView?.()}>
                <Maximize size={16} />
              </BarButton>
              <BarButton title="全屏显示(Esc 退出)" onClick={() => ctl()?.enterFullScreen?.()}>
                <Expand size={16} />
              </BarButton>
            </>
          ) : null}

          {/* 通用操作 */}
          <div className="flex-1" />
          <Sep />
          <BarButton title="在系统资源管理器中显示" onClick={() => void revealInExplorer(file.path)}>
            <FolderOpen size={16} />
          </BarButton>
          <BarButton title="复制文件路径" onClick={() => void copyPath(file.path)}>
            <Copy size={16} />
          </BarButton>
        </>
      )}
    </div>
  );
}
