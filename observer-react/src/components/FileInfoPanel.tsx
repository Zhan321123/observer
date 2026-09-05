import { useEffect, useState } from "react";
import { Copy } from "lucide-react";
import { useGridStore } from "../stores/gridStore";
import { useCellViewStore } from "../stores/cellViewStore";
import { fileStat, detectFormat, assetUrl, copyPath, ffprobeMeta } from "../lib/tauri";
import { readExif, type ExifSummary } from "../lib/exif";
import { formatBytes, formatDateTime, formatTime } from "../lib/format";
import type { FileStat, DetectResult, VideoMeta } from "../types/file";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2 py-[3px] text-xs">
      <span className="w-16 shrink-0 text-text-dim">{label}</span>
      <span className="min-w-0 flex-1 break-words text-text">{children}</span>
    </div>
  );
}

/** 文件信息 frame(§6):显示选中格文件信息;无选中时"未选择文件"。 */
export function FileInfoPanel() {
  const selected = useGridStore((s) => s.selected);
  const file = useGridStore((s) => (s.selected != null ? s.cells[s.selected]?.file : null));
  const view = useCellViewStore((s) => (selected != null ? s.views[selected] : undefined));

  const [stat, setStat] = useState<FileStat | null>(null);
  const [detect, setDetect] = useState<DetectResult | null>(null);
  const [imgRes, setImgRes] = useState<string | null>(null);
  const [meta, setMeta] = useState<VideoMeta | null>(null);
  const [exif, setExif] = useState<ExifSummary | null>(null);
  const [exifLoaded, setExifLoaded] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setStat(null);
    setDetect(null);
    setImgRes(null);
    setMeta(null);
    setExif(null);
    setExifLoaded(false);
    if (!file) return;
    let cancelled = false;
    fileStat(file.path).then((s) => !cancelled && setStat(s)).catch(() => {});
    detectFormat(file.path).then((d) => !cancelled && setDetect(d)).catch(() => {});
    if (file.kind === "image") {
      const img = new Image();
      img.onload = () => !cancelled && setImgRes(`${img.naturalWidth} × ${img.naturalHeight}`);
      img.onerror = () => {};
      img.src = assetUrl(file.path);
      // EXIF 摘要 / 色彩空间(M2):读原文件字节解析,失败/无 EXIF → exif=null
      readExif(assetUrl(file.path))
        .then((e) => {
          if (!cancelled) {
            setExif(e);
            setExifLoaded(true);
          }
        })
        .catch(() => !cancelled && setExifLoaded(true));
    }
    if (file.kind === "video" || file.kind === "audio") {
      ffprobeMeta(file.path).then((m) => !cancelled && setMeta(m)).catch(() => {});
    }
    return () => {
      cancelled = true;
    };
  }, [file]);

  if (!file) {
    return (
      <div className="flex h-full items-center justify-center bg-panel text-xs text-text-dim">
        未选择文件
      </div>
    );
  }

  const onCopy = async () => {
    await copyPath(file.path);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  const kindLabel: Record<string, string> = {
    image: "图片", video: "视频", audio: "音频", text: "文本", markdown: "Markdown",
    spreadsheet: "表格", pdf: "PDF", threed: "3D 模型", anim: "动效",
    archive: "压缩包", unknown: "未知",
  };

  const mediaDuration = (file.kind === "video" || file.kind === "audio") ? view?.duration : undefined;

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-panel p-3">
      <div className="mb-1 flex items-start justify-between gap-2">
        <div className="min-w-0 break-all text-sm font-medium text-text">{file.name}</div>
        <button
          className="shrink-0 rounded p-1 text-text-dim hover:bg-panel-2 hover:text-text"
          title="复制绝对路径"
          onClick={onCopy}
        >
          <Copy size={13} />
        </button>
      </div>

      <Row label="类型">{kindLabel[file.kind] ?? file.kind}</Row>
      <Row label="格式">
        {file.ext ? `.${file.ext}` : "-"}
        {detect?.sniffed ? `(探测:${detect.sniffed})` : ""}
      </Row>
      <Row label="大小">{stat ? formatBytes(stat.size) : "-"}</Row>
      <Row label="修改时间">{stat ? formatDateTime(stat.mtime) : "-"}</Row>
      {/* 文本编码(read_text_file 探测,由 TextView 载入后写入视图态) */}
      {(file.kind === "text" || file.kind === "markdown") && view?.textEncoding && (
        <Row label="编码">{view.textEncoding}</Row>
      )}
      <Row label="路径">
        <span className="break-all text-text-dim">{file.path}</span>
      </Row>
      {copied && <div className="text-[11px] text-brand-bright">已复制路径</div>}

      {file.kind === "image" && imgRes && <Row label="分辨率">{imgRes}</Row>}
      {/* EXIF 摘要 / 色彩空间(M2):有则逐项显示,无则提示;解析中不闪占位 */}
      {file.kind === "image" && exifLoaded && (
        <>
          {exif?.camera && <Row label="相机">{exif.camera}</Row>}
          {exif?.lens && <Row label="镜头">{exif.lens}</Row>}
          {exif?.exposure && <Row label="曝光">{exif.exposure}</Row>}
          {exif?.colorSpace && <Row label="色彩空间">{exif.colorSpace}</Row>}
          {exif?.takenAt && <Row label="拍摄时间">{formatDateTime(exif.takenAt)}</Row>}
          {!exif && <Row label="EXIF"><span className="text-text-dim/60">无 EXIF 信息</span></Row>}
        </>
      )}

      {/* 视频/音频元信息(ffprobe,M1) */}
      {(file.kind === "video" || file.kind === "audio") && (
        <>
          {(() => {
            const d = meta?.duration ?? mediaDuration;
            return d != null && d > 0 ? <Row label="时长">{formatTime(d)}</Row> : null;
          })()}
          {meta?.width != null && meta?.height != null && (
            <Row label="分辨率">{meta.width} × {meta.height}</Row>
          )}
          {meta?.frame_rate != null && <Row label="帧率">{meta.frame_rate.toFixed(2)} fps</Row>}
          {meta?.video_codec && (
            <Row label="视频编码">
              {meta.video_codec}
              {meta.hdr && <span className="ml-1 rounded bg-brand/30 px-1 text-[10px] text-brand-bright">HDR</span>}
            </Row>
          )}
          {meta?.audio_codec && (
            <Row label="音频编码">
              {meta.audio_codec}
              {meta.sample_rate != null && ` · ${meta.sample_rate} Hz`}
              {meta.channels != null && ` · ${meta.channels} 声道`}
            </Row>
          )}
          {meta?.bit_rate != null && <Row label="码率">{fmtBitrate(meta.bit_rate)}</Row>}
          {!meta && <Row label="编码/码率"><span className="text-text-dim/60">ffprobe 探测中…</span></Row>}
        </>
      )}

      {/* 3D 模型统计(layout.md §6):顶点/面数、材质数、动画数、包围盒尺寸(由 ThreeView 加载后写入) */}
      {file.kind === "threed" && (
        <>
          {view?.threedInfo ? (
            <>
              <Row label="顶点 / 面">
                {view.threedInfo.vertices.toLocaleString()} / {view.threedInfo.triangles.toLocaleString()}
              </Row>
              <Row label="材质数">{view.threedInfo.materials}</Row>
              <Row label="动画数">{view.threedInfo.animations}</Row>
              <Row label="包围盒">
                {view.threedInfo.bbox.map(fmtDim).join(" × ")}
              </Row>
            </>
          ) : (
            <Row label="模型"><span className="text-text-dim/60">解析中…</span></Row>
          )}
        </>
      )}
    </div>
  );
}

/** 3D 包围盒单维尺寸 → 可读(世界单位跨度大,自适应精度) */
function fmtDim(n: number): string {
  if (!Number.isFinite(n)) return "-";
  if (n === 0) return "0";
  const a = Math.abs(n);
  if (a >= 1000 || a < 0.01) return n.toExponential(2);
  return String(Math.round(n * 100) / 100);
}

/** 码率(bps)→ 可读(kbps/Mbps) */
function fmtBitrate(bps: number): string {
  if (!Number.isFinite(bps) || bps <= 0) return "-";
  return bps >= 1_000_000 ? `${(bps / 1_000_000).toFixed(1)} Mbps` : `${Math.round(bps / 1000)} kbps`;
}
