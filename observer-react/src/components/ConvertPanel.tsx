import { useEffect, useState } from "react";
import { FolderOpen, X } from "lucide-react";
import { useGridStore } from "../stores/gridStore";
import { useCellViewStore } from "../stores/cellViewStore";
import { getControl } from "../stores/cellControls";
import { bytesToBase64, convertWrite, openFolderDialog, revealInExplorer } from "../lib/tauri";
import { exportThreed, type ThreedTargetFormat } from "../lib/threeExport";

/** 全部目标格式(即下拉顺序);无 Mesh 的源(点云/线段/骨骼)只剩前两项 */
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
 * 格式转换 frame(§7,M5 首片:3D 模型导出)。
 * 目标格式下拉(允许与源同格式,如压缩 GLB 重编码)/ 输出目录(默认源文件所在目录,
 * 重名自动 " (n)" 绝不覆盖)/ 有贴图转仅几何格式前弹提醒。图片/音视频类别待后续接入本面板。
 */
export function ConvertPanel() {
  const selected = useGridStore((s) => s.selected);
  const file = useGridStore((s) => (s.selected != null ? s.cells[s.selected]?.file : null));
  const view = useCellViewStore((s) => (selected != null ? s.views[selected] : undefined));

  const info = view?.threedInfo;
  const isThreed = file?.kind === "threed";

  const [outDir, setOutDir] = useState("");
  const [format, setFormat] = useState<ThreedTargetFormat>("glb");
  const [busy, setBusy] = useState(false);
  /** 成功:最终写入路径(含去重后的名字);失败原因走 error */
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [warnOpen, setWarnOpen] = useState(false);

  const filePath = file?.path ?? null;
  useEffect(() => {
    // 切换选中文件:输出目录回默认(文件所在目录),其余状态清零(防残留上一文件的"已写入")
    setOutDir(filePath ? filePath.replace(/[\\/][^\\/]*$/, "") : "");
    setFormat("glb");
    setResult(null);
    setError(null);
    setWarnOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filePath]);

  const formats: readonly ThreedTargetFormat[] = info?.hasMesh
    ? ALL_FORMATS
    : ["glb", "gltf"];
  useEffect(() => {
    if (!formats.includes(format)) setFormat("glb");
  }, [formats, format]);

  const targetName = file ? file.name.replace(/\.[^.]+$/, "") + "." + format : "";
  const canConvert = isThreed && !!info && !view?.error && !busy && !!outDir.trim();

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

  /** 转换前提醒(确认弹窗):有贴图转仅几何格式(丢贴图)/ 爆炸图开启(产物保留零件分离位置) */
  const warnLossy = !!info?.hasTextures && LOSSY_FORMATS.includes(format);
  const warnExploded = (view?.threedExplode ?? 0) > 0;
  const onConvertClick = () => {
    if (warnLossy || warnExploded) setWarnOpen(true);
    else void doConvert();
  };

  if (!file) {
    return (
      <div className="flex h-full items-center justify-center bg-panel text-xs text-text-dim">
        未选择文件
      </div>
    );
  }
  if (!isThreed) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1 bg-panel p-4 text-center">
        <div className="text-xs text-text-dim">暂不支持该类型转换</div>
        <div className="text-[11px] text-text-dim/60">当前支持 3D 模型</div>
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
        onClick={onConvertClick}
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

      <ConvertWarnModal
        open={warnOpen}
        format={format}
        lossy={warnLossy}
        exploded={warnExploded}
        hasAnim={(info?.animations ?? 0) > 0}
        onClose={() => setWarnOpen(false)}
        onConfirm={() => {
          setWarnOpen(false);
          void doConvert();
        }}
      />
    </div>
  );
}

/** 转换前提醒(有贴图→STL/OBJ/PLY 丢贴图;爆炸图开启→产物保留分离位置):确认后才开始转换。骨架循 SettingsDialog。 */
function ConvertWarnModal({
  open,
  format,
  lossy,
  exploded,
  hasAnim,
  onClose,
  onConfirm,
}: {
  open: boolean;
  format: ThreedTargetFormat;
  /** 有贴图 → 仅几何格式(丢贴图/材质,或含动画) */
  lossy: boolean;
  /** 爆炸图开启(导出的是活模型当前 transform,分离位置会被烘进产物) */
  exploded: boolean;
  hasAnim: boolean;
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
          <h2 className="text-sm font-medium">格式转换提醒</h2>
          <button className="text-text-dim hover:text-text" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <div className="px-4 py-4 text-xs leading-relaxed">
          {lossy && (
            <div>转换到 {FORMAT_LABELS[format]} 将丢失贴图/材质{hasAnim ? "及动画" : ""},该操作不可恢复。</div>
          )}
          {exploded && (
            <div className={lossy ? "mt-1.5" : undefined}>
              模型处于爆炸状态,转换产物将保留零件分离位置(关闭爆炸图后转换可导出装配状态)。
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
