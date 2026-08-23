import { useEffect } from "react";
import { X } from "lucide-react";
import { useSettingsStore, type GridFullPolicy } from "../stores/settingsStore";

interface Props {
  open: boolean;
  onClose: () => void;
}

/** 设置对话框(§2):资源配额 / 宫格 / 图片偏好 / 记录管理(说明)。 */
export function SettingsDialog({ open, onClose }: Props) {
  const mediaQuota = useSettingsStore((s) => s.mediaQuota);
  const threeDQuota = useSettingsStore((s) => s.threeDQuota);
  const imageDefaultFit = useSettingsStore((s) => s.imageDefaultFit);
  const gridFullPolicy = useSettingsStore((s) => s.gridFullPolicy);
  const setMediaQuota = useSettingsStore((s) => s.setMediaQuota);
  const setThreeDQuota = useSettingsStore((s) => s.setThreeDQuota);
  const setImageDefaultFit = useSettingsStore((s) => s.setImageDefaultFit);
  const setGridFullPolicy = useSettingsStore((s) => s.setGridFullPolicy);
  const textMaxSizeMB = useSettingsStore((s) => s.textMaxSizeMB);
  const setTextMaxSizeMB = useSettingsStore((s) => s.setTextMaxSizeMB);
  const defaultVolume = useSettingsStore((s) => s.defaultVolume);
  const setDefaultVolume = useSettingsStore((s) => s.setDefaultVolume);

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
      <div className="w-[420px] rounded-lg border border-line bg-panel shadow-2xl">
        <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
          <h2 className="text-sm font-medium">设置</h2>
          <button className="text-text-dim hover:text-text" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div className="space-y-5 px-4 py-4">
          <section>
            <h3 className="mb-2 text-xs font-medium text-text-dim">资源配额(§4.7)</h3>
            <label className="mb-2 flex items-center justify-between text-xs">
              <span>同时播放的流媒体路数(视频+音频)</span>
              <input
                type="number"
                min={1}
                className="w-16 rounded border border-line bg-panel-2 px-2 py-1 text-right outline-none"
                value={mediaQuota}
                onChange={(e) => setMediaQuota(Number(e.target.value))}
              />
            </label>
            <label className="flex items-center justify-between text-xs">
              <span>激活 3D 视口数上限(硬上限 8)</span>
              <input
                type="number"
                min={1}
                max={8}
                className="w-16 rounded border border-line bg-panel-2 px-2 py-1 text-right outline-none"
                value={threeDQuota}
                onChange={(e) => setThreeDQuota(Number(e.target.value))}
              />
            </label>
          </section>

          <section>
            <h3 className="mb-2 text-xs font-medium text-text-dim">宫格</h3>
            <label className="flex items-center justify-between text-xs">
              <span>宫格占满时打开文件</span>
              <select
                className="rounded border border-line bg-panel-2 px-2 py-1 outline-none"
                value={gridFullPolicy}
                onChange={(e) => setGridFullPolicy(e.target.value as GridFullPolicy)}
              >
                <option value="selected">覆盖选中的宫格</option>
                <option value="first">覆盖第一宫格</option>
                <option value="sequential">从第一宫格依次覆盖</option>
              </select>
            </label>
          </section>

          <section>
            <h3 className="mb-2 text-xs font-medium text-text-dim">图片</h3>
            <label className="flex items-center justify-between text-xs">
              <span>默认缩放模式</span>
              <select
                className="rounded border border-line bg-panel-2 px-2 py-1 outline-none"
                value={imageDefaultFit}
                onChange={(e) => setImageDefaultFit(e.target.value as "best-fit" | "actual")}
              >
                <option value="best-fit">最佳显示(适应宫格)</option>
                <option value="actual">1:1(实际像素)</option>
              </select>
            </label>
          </section>

          <section>
            <h3 className="mb-2 text-xs font-medium text-text-dim">文本</h3>
            <label className="flex items-center justify-between text-xs">
              <span>文本最大打开大小 (MB,超出需确认)</span>
              <input
                type="number"
                min={1}
                max={1024}
                className="w-16 rounded border border-line bg-panel-2 px-2 py-1 text-right outline-none"
                value={textMaxSizeMB}
                onChange={(e) => setTextMaxSizeMB(Number(e.target.value))}
              />
            </label>
          </section>

          <section>
            <h3 className="mb-2 text-xs font-medium text-text-dim">播放</h3>
            <label className="flex items-center justify-between gap-3 text-xs">
              <span>默认音量(新文件以此音量打开)</span>
              <span className="flex items-center gap-2">
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  className="w-28 accent-brand-bright"
                  value={defaultVolume}
                  onChange={(e) => setDefaultVolume(Number(e.target.value))}
                />
                <span className="w-9 text-right tabular-nums text-text-dim">
                  {Math.round(defaultVolume * 100)}%
                </span>
              </span>
            </label>
          </section>

          <section>
            <h3 className="mb-2 text-xs font-medium text-text-dim">记录管理</h3>
            <p className="text-xs leading-relaxed text-text-dim/70">
              预览历史可从顶栏「历史」查看与清空。播放位置 / 滚动位置 / 3D 视角已随持久化层(SQLite)落盘并自动恢复;
              按类型分组的选择性删除、保留策略等完整记录管理将随 M2 提供(design.md §9.4)。
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
