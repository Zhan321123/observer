import { useEffect, useState } from "react";
import { FolderOpen, X } from "lucide-react";
import { useGridStore } from "../stores/gridStore";
import { useCellViewStore } from "../stores/cellViewStore";
import { getControl } from "../stores/cellControls";
import {
  bytesToBase64,
  convertImage,
  convertWrite,
  imageInfo,
  openFolderDialog,
  revealInExplorer,
  type ImageInfo,
} from "../lib/tauri";
import { exportThreed, type ThreedTargetFormat } from "../lib/threeExport";
import {
  IMAGE_TARGET_LABELS,
  imageConvertWarnings,
  imageOutputCount,
  targetsForSource,
  type ImageTargetFormat,
} from "../lib/imageConvert";

/** 全部 3D 目标格式(即下拉顺序);无 Mesh 的源(点云/线段/骨骼)只剩前两项 */
const ALL_FORMATS: ThreedTargetFormat[] = ["glb", "gltf", "stl", "obj", "ply"];
/** 仅几何格式:贴图/材质会丢,源有贴图时转换前须提醒 */
const LOSSY_FORMATS: ThreedTargetFormat[] = ["stl", "obj", "ply"];
const FORMAT_LABELS: Record<ThreedTargetFormat, string> = {
  glb: "GLB",
  gltf: "GLTF",
  stl: "STL",
  obj: "OBJ",
  ply: "PLY",
};

/**
 * 格式转换 frame(§7,M5:3D 模型导出 + 图片转换)。按选中文件 kind 分支:
 * threed → ThreedSection(前端 three.js exporter 生成字节,convertWrite 落盘);
 * image → ImageSection(Rust 解码→编码全程,convert_image 返回路径列表)。
 * 点击转换一律先弹确认弹窗(无警告时显示摘要)。图片/音视频类别待后续接入本面板。
 */
export function ConvertPanel() {
  const file = useGridStore((s) => (s.selected != null ? s.cells[s.selected]?.file : null));

  if (!file) {
    return (
      <div className="flex h-full items-center justify-center bg-panel text-xs text-text-dim">
        未选择文件
      </div>
    );
  }
  if (file.kind === "threed") return <ThreedSection />;
  if (file.kind === "image") return <ImageSection />;
  return (
    <div className="flex h-full flex-col items-center justify-center gap-1 bg-panel p-4 text-center">
      <div className="text-xs text-text-dim">暂不支持该类型转换</div>
      <div className="text-[11px] text-text-dim/60">当前支持 3D 模型与图片</div>
    </div>
  );
}

/** 3D 模型转换(M5 首片,原有逻辑;行为变更:点击转换一律先确认) */
function ThreedSection() {
  const selected = useGridStore((s) => s.selected);
  const file = useGridStore((s) => (s.selected != null ? s.cells[s.selected]?.file : null));
  const view = useCellViewStore((s) => (selected != null ? s.views[selected] : undefined));

  const info = view?.threedInfo;

  const [outDir, setOutDir] = useState("");
  const [format, setFormat] = useState<ThreedTargetFormat>("glb");
  const [busy, setBusy] = useState(false);
  /** 成功:最终写入路径(含去重后的名字);失败原因走 error */
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const filePath = file?.path ?? null;
  useEffect(() => {
    // 切换选中文件:输出目录回默认(文件所在目录),其余状态清零(防残留上一文件的"已写入")
    setOutDir(filePath ? filePath.replace(/[\\/][^\\/]*$/, "") : "");
    setFormat("glb");
    setResult(null);
    setError(null);
    setConfirmOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filePath]);

  const formats: readonly ThreedTargetFormat[] = info?.hasMesh
    ? ALL_FORMATS
    : ["glb", "gltf"];
  useEffect(() => {
    if (!formats.includes(format)) setFormat("glb");
  }, [formats, format]);

  const targetName = file ? file.name.replace(/\.[^.]+$/, "") + "." + format : "";
  const canConvert = !!info && !view?.error && !busy && !!outDir.trim();

  const onBrowse = async () => {
    const d = await openFolderDialog();
    if (typeof d === "string") setOutDir(d); // 取消返回 null → 保留当前值
  };

  const doConvert = async () => {
    if (!file || !canConvert) return;
    const pathAtStart = file.path;
    setBusy(true);
    setResult(null);
    setError(null);
    try {
      const model = getControl(selected)?.threedExportModel?.() ?? null;
      if (!model) throw new Error("模型尚未就绪,请稍候重试");
      const bytes = await exportThreed(model.object, model.animations, format);
      const finalPath = await convertWrite(outDir.trim(), targetName, bytesToBase64(bytes));
      // 转换期间切走选中:文件已正确写出,但结果不展示到新文件的表单下
      if (useGridStore.getState().cells[selected ?? -1]?.file?.path !== pathAtStart) return;
      setResult(finalPath);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e)); // Rust Err 也是 string
    } finally {
      setBusy(false);
    }
  };

  /** 确认弹窗内容:摘要 + 警告(有贴图转仅几何格式丢贴图/爆炸图开启保留分离位置) */
  const warnLossy = !!info?.hasTextures && LOSSY_FORMATS.includes(format);
  const warnExploded = (view?.threedExplode ?? 0) > 0;
  const warnings: string[] = [];
  if (warnLossy) {
    warnings.push(
      `转换到 ${FORMAT_LABELS[format]} 将丢失贴图/材质${(info?.animations ?? 0) > 0 ? "及动画" : ""},该操作不可恢复。`,
    );
  }
  if (warnExploded) {
    warnings.push("模型处于爆炸状态,转换产物将保留零件分离位置(关闭爆炸图后转换可导出装配状态)。");
  }
  const summaryLines = [
    `${file?.name} → ${targetName}`,
    `输出目录:${outDir.trim() || "(未填)"}`,
    "输出文件:1 张",
  ];

  return (
    <div className="flex h-full flex-col gap-2 overflow-y-auto bg-panel p-3 text-xs">
      <div>
        <span className="mb-1 block text-text-dim">输出目录</span>
        <div className="flex items-center gap-1">
          <input
            className="min-w-0 flex-1 rounded border border-line bg-panel-2 px-2 py-1 outline-none"
            value={outDir}
            onChange={(e) => setOutDir(e.target.value)}
            spellCheck={false}
          />
          <button
            className="shrink-0 rounded px-2 py-1 text-text-dim hover:bg-panel-2 hover:text-text"
            title="浏览目录"
            onClick={() => void onBrowse()}
          >
            <FolderOpen size={14} />
          </button>
        </div>
      </div>

      <label className="block">
        <span className="mb-1 block text-text-dim">目标格式</span>
        <select
          className="w-full rounded border border-line bg-panel-2 px-2 py-1 outline-none"
          value={format}
          onChange={(e) => setFormat(e.target.value as ThreedTargetFormat)}
        >
          {formats.map((f) => (
            <option key={f} value={f}>
              {FORMAT_LABELS[f]}
            </option>
          ))}
        </select>
      </label>

      {info && !info.hasMesh && (
        <div className="text-[11px] leading-relaxed text-text-dim/70">
          点云/线段/骨骼模型仅支持 GLB / GLTF
        </div>
      )}
      {!info && !view?.error && <div className="text-[11px] text-text-dim/70">模型解析中…</div>}

      <div>
        <span className="text-text-dim">输出文件:</span>
        <span className="ml-1 text-text">{targetName}</span>
      </div>

      <button
        className="rounded bg-brand/20 px-3 py-1.5 text-xs text-brand-bright hover:bg-brand/40 disabled:opacity-40"
        disabled={!canConvert}
        onClick={() => setConfirmOpen(true)}
      >
        {busy ? "转换中…" : "转换"}
      </button>

      {view?.error && <div className="break-all text-danger">{view.error}</div>}
      {error && <div className="break-all text-danger">{error}</div>}
      {result && (
        <div className="flex items-start gap-1">
          <div className="min-w-0 flex-1 break-all text-text-dim">已写入:{result}</div>
          <button
            className="shrink-0 text-text-dim hover:text-text"
            title="打开所在文件夹"
            onClick={() => void revealInExplorer(result)}
          >
            <FolderOpen size={13} />
          </button>
        </div>
      )}

      <ConvertConfirmModal
        open={confirmOpen}
        summaryLines={summaryLines}
        warnings={warnings}
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => {
          setConfirmOpen(false);
          void doConvert();
        }}
      />
    </div>
  );
}

/** 图片转换(M5 第二片):Rust 解码→编码全程,前端只传路径/格式,收路径列表 */
function ImageSection() {
  const selected = useGridStore((s) => s.selected);
  const file = useGridStore((s) => (s.selected != null ? s.cells[s.selected]?.file : null));
  const view = useCellViewStore((s) => (selected != null ? s.views[selected] : undefined));

  const [outDir, setOutDir] = useState("");
  const [format, setFormat] = useState<ImageTargetFormat>("png");
  const [busy, setBusy] = useState(false);
  /** 成功:全部写出路径(多图输出为首路径 + N);失败原因走 error */
  const [result, setResult] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [info, setInfo] = useState<ImageInfo | null>(null);
  /** info 竞态防护:仅当嗅探结果对应当前文件时才采用 */
  const [infoPath, setInfoPath] = useState<string | null>(null);

  const filePath = file?.path ?? null;
  useEffect(() => {
    // 切换选中文件:输出目录回默认(文件所在目录),其余状态清零(防残留上一文件的"已写入")
    setOutDir(filePath ? filePath.replace(/[\\/][^\\/]*$/, "") : "");
    setFormat("png");
    setResult(null);
    setError(null);
    setConfirmOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filePath]);

  useEffect(() => {
    // 头部嗅探(供警告/摘要判定);失败静默——警告缺席不阻塞转换,错误在转换时如实暴露
    if (!filePath) {
      setInfo(null);
      setInfoPath(null);
      return;
    }
    let cancelled = false;
    setInfo(null);
    setInfoPath(null);
    imageInfo(filePath)
      .then((r) => {
        if (!cancelled) {
          setInfo(r);
          setInfoPath(filePath);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [filePath]);

  const targets = targetsForSource(file?.ext);
  useEffect(() => {
    if (targets && !targets.includes(format)) setFormat("png");
  }, [targets, format]);

  const validInfo = infoPath === filePath ? info : null;
  const stem = file ? file.name.replace(/\.[^.]+$/, "") : "";
  const count = imageOutputCount(file?.ext, validInfo, format);
  const warnings = imageConvertWarnings(file?.ext, validInfo, format);
  const firstOut = `${stem}${count > 1 ? "_001" : ""}.${format}`;
  const canConvert = !!targets && !busy && !!outDir.trim() && !view?.error;

  const onBrowse = async () => {
    const d = await openFolderDialog();
    if (typeof d === "string") setOutDir(d); // 取消返回 null → 保留当前值
  };

  const doConvert = async () => {
    if (!file || !canConvert) return;
    const pathAtStart = file.path;
    setBusy(true);
    setResult(null);
    setError(null);
    try {
      const paths = await convertImage(file.path, format, outDir.trim());
      // 转换期间切走选中:文件已正确写出,但结果不展示到新文件的表单下
      if (useGridStore.getState().cells[selected ?? -1]?.file?.path !== pathAtStart) return;
      setResult(paths);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e)); // Rust Err 也是 string
    } finally {
      setBusy(false);
    }
  };

  const summaryLines = [
    `${file?.name} → ${firstOut}${count > 1 ? ` 等 ${count} 张` : ""}`,
    `输出目录:${outDir.trim() || "(未填)"}`,
    `输出文件:${count} 张`,
  ];
  if (validInfo && validInfo.width > 0) {
    summaryLines.push(`原始分辨率 ${validInfo.width}×${validInfo.height},保持原尺寸不缩放`);
  }

  // AVIF 源:说明文案,无表单(纯 Rust 无解码器;dav1d C 库与 ffmpeg 管道待后续)
  if (!targets) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1 bg-panel p-4 text-center">
        <div className="text-xs text-text-dim">AVIF 源暂不支持转换</div>
        <div className="text-[11px] text-text-dim/60">缺纯 Rust 解码器(输出侧 AVIF 编码亦未启用)</div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-2 overflow-y-auto bg-panel p-3 text-xs">
      <div>
        <span className="mb-1 block text-text-dim">输出目录</span>
        <div className="flex items-center gap-1">
          <input
            className="min-w-0 flex-1 rounded border border-line bg-panel-2 px-2 py-1 outline-none"
            value={outDir}
            onChange={(e) => setOutDir(e.target.value)}
            spellCheck={false}
          />
          <button
            className="shrink-0 rounded px-2 py-1 text-text-dim hover:bg-panel-2 hover:text-text"
            title="浏览目录"
            onClick={() => void onBrowse()}
          >
            <FolderOpen size={14} />
          </button>
        </div>
      </div>

      <label className="block">
        <span className="mb-1 block text-text-dim">目标格式</span>
        <select
          className="w-full rounded border border-line bg-panel-2 px-2 py-1 outline-none"
          value={format}
          onChange={(e) => setFormat(e.target.value as ImageTargetFormat)}
        >
          {targets.map((f) => (
            <option key={f} value={f}>
              {IMAGE_TARGET_LABELS[f]}
            </option>
          ))}
        </select>
      </label>

      <div>
        <span className="text-text-dim">输出文件:</span>
        <span className="ml-1 text-text">{firstOut}</span>
        {count > 1 && <span className="ml-1 text-text-dim">等 {count} 张</span>}
      </div>

      {warnings.length > 0 && (
        <div className="space-y-1 text-[11px] leading-relaxed text-danger/90">
          {warnings.map((w, i) => (
            <div key={i}>{w}</div>
          ))}
        </div>
      )}

      <button
        className="rounded bg-brand/20 px-3 py-1.5 text-xs text-brand-bright hover:bg-brand/40 disabled:opacity-40"
        disabled={!canConvert}
        onClick={() => setConfirmOpen(true)}
      >
        {busy ? "转换中…" : "转换"}
      </button>

      {view?.error && <div className="break-all text-danger">{view.error}</div>}
      {error && <div className="break-all text-danger">{error}</div>}
      {result && (
        <div className="flex items-start gap-1">
          <div className="min-w-0 flex-1 break-all text-text-dim">
            {result.length > 1
              ? `已写入 ${result.length} 张:${result[0]}(等 ${result.length} 张)`
              : `已写入:${result[0]}`}
          </div>
          <button
            className="shrink-0 text-text-dim hover:text-text"
            title="打开所在文件夹"
            onClick={() => void revealInExplorer(result[0])}
          >
            <FolderOpen size={13} />
          </button>
        </div>
      )}

      <ConvertConfirmModal
        open={confirmOpen}
        summaryLines={summaryLines}
        warnings={warnings}
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => {
          setConfirmOpen(false);
          void doConvert();
        }}
      />
    </div>
  );
}

/** 转换前确认弹窗(3D 与图片共用):一律先确认——无警告时也显示摘要。
 *  骨架循原 ConvertWarnModal / SettingsDialog。 */
function ConvertConfirmModal({
  open,
  summaryLines,
  warnings,
  onClose,
  onConfirm,
}: {
  open: boolean;
  /** 摘要块(源 → 目标 / 输出目录 / 输出文件数 / 分辨率等) */
  summaryLines: string[];
  /** 警告列表(可空;空时仅显示摘要) */
  warnings: string[];
  onClose: () => void;
  onConfirm: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-[360px] rounded-lg border border-line bg-panel shadow-2xl">
        <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
          <h2 className="text-sm font-medium">确认转换</h2>
          <button className="text-text-dim hover:text-text" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <div className="px-4 py-4 text-xs leading-relaxed">
          <div className="break-all text-text-dim">
            {summaryLines.map((line, i) => (
              <div key={i} className={i > 0 ? "mt-1" : undefined}>
                {line}
              </div>
            ))}
          </div>
          {warnings.length > 0 && (
            <div className="mt-2 space-y-1.5 text-danger">
              {warnings.map((w, i) => (
                <div key={i}>{w}</div>
              ))}
            </div>
          )}
          是否继续?
        </div>
        <div className="flex justify-end gap-2 border-t border-line px-4 py-3">
          <button
            className="rounded px-2.5 py-1 text-text-dim hover:bg-panel-2 hover:text-text"
            onClick={onClose}
          >
            取消
          </button>
          <button
            className="rounded bg-brand/20 px-3 py-1.5 text-xs text-brand-bright hover:bg-brand/40"
            onClick={onConfirm}
          >
            继续转换
          </button>
        </div>
      </div>
    </div>
  );
}
