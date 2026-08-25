import {
  Play, Pause, Volume2, VolumeX, SkipBack, SkipForward, ChevronLeft, ChevronRight,
  Maximize, Expand, ZoomIn, ZoomOut, FolderOpen, Copy, Ratio, Scan,
  ListOrdered, WrapText, ClipboardCopy, Eye, FileCode, Film, LayoutGrid, Table,
  RotateCcw, Orbit, Box, Grid3x3, Lightbulb,
} from "lucide-react";
import { useGridStore } from "../stores/gridStore";
import { useCellViewStore } from "../stores/cellViewStore";
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
 */
export function FunctionBar() {
  const selected = useGridStore((s) => s.selected);
  const cell = useGridStore((s) => (s.selected != null ? s.cells[s.selected] : null));
  const view = useCellViewStore((s) => (selected != null ? s.views[selected] : undefined));

  const file = cell?.file ?? null;
  const kind = file?.kind;
  // 事件时取控制:cellControls 是普通 Map(非响应式),渲染期快照会拿到过期的死闭包
  // (xlsx 异步解析完成后重注册,快照仍指向 wb=null 的旧控制 → 切 sheet 无反应)。
  const ctl = () => getControl(selected);

  const isMedia = kind === "video" || kind === "audio";
  const isImage = kind === "image";
  const isText = kind === "text" || kind === "markdown";
  const isSpreadsheet = kind === "spreadsheet";
  const isPdf = kind === "pdf";
  const isThreed = kind === "threed";
  const isAnim = kind === "anim";
  const isGif = file?.ext === "gif";
  const isIco = file?.ext === "ico";
  const isSvg = file?.ext === "svg";
  const isCsv = file?.ext === "csv" || file?.ext === "tsv";
  const isLottie = file?.sniffed === "lottie";
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

  return (
    <div className="flex h-11 shrink-0 items-center gap-1 overflow-x-auto border-t border-line bg-panel px-2">
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
              {/* lottie(.json):动画 / 文本 */}
              {isLottie && (
                <BarButton
                  title={view?.lottieMode === "text" ? "切换到动画" : "切换到文本"}
                  active={view?.lottieMode !== "text"}
                  onClick={() => ctl()?.toggleLottieMode?.()}
                >
                  {view?.lottieMode === "text" ? <Film size={16} /> : <FileCode size={16} />}
                </BarButton>
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
              <span className="w-8 text-center text-[11px] tabular-nums text-text-dim">{view?.fontSize ?? 13}</span>
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

          {/* 表格组(xlsx):sheet 下拉 */}
          {isSpreadsheet && (
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

          {/* 全界面 / 全屏(图片 / 视频 / PDF / 3D,§4.6) */}
          {(isImage || kind === "video" || isPdf || isThreed) && (
            <>
              <Sep />
              <BarButton title="全界面显示(Esc 退出)" onClick={() => ctl()?.enterFullView?.()}>
                <Maximize size={16} />
              </BarButton>
              <BarButton title="全屏显示(Esc 退出)" onClick={() => ctl()?.enterFullScreen?.()}>
                <Expand size={16} />
              </BarButton>
            </>
          )}

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
