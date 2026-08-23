import { useEffect, useState } from "react";
import { Copy } from "lucide-react";
import { useGridStore } from "../stores/gridStore";
import { useCellViewStore } from "../stores/cellViewStore";
import { fileStat, detectFormat, assetUrl, copyPath } from "../lib/tauri";
import { formatBytes, formatDateTime, formatTime } from "../lib/format";
import type { FileStat, DetectResult } from "../types/file";

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
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setStat(null);
    setDetect(null);
    setImgRes(null);
    if (!file) return;
    let cancelled = false;
    fileStat(file.path).then((s) => !cancelled && setStat(s)).catch(() => {});
    detectFormat(file.path).then((d) => !cancelled && setDetect(d)).catch(() => {});
    if (file.kind === "image") {
      const img = new Image();
      img.onload = () => !cancelled && setImgRes(`${img.naturalWidth} × ${img.naturalHeight}`);
      img.onerror = () => {};
      img.src = assetUrl(file.path);
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
    image: "图片", video: "视频", audio: "音频", text: "文本", markdown: "Markdown", unknown: "未知",
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
      <Row label="路径">
        <span className="break-all text-text-dim">{file.path}</span>
      </Row>
      {copied && <div className="text-[11px] text-brand-bright">已复制路径</div>}

      {file.kind === "image" && imgRes && <Row label="分辨率">{imgRes}</Row>}
      {file.kind === "image" && <Row label="色彩/EXIF"><span className="text-text-dim/60">后续提供</span></Row>}

      {mediaDuration != null && mediaDuration > 0 && <Row label="时长">{formatTime(mediaDuration)}</Row>}
      {(file.kind === "video" || file.kind === "audio") && (
        <Row label="编码/码率"><span className="text-text-dim/60">需 ffprobe(后续)</span></Row>
      )}
    </div>
  );
}
