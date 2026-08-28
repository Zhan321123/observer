import { useCallback, useEffect, useState } from "react";
import { X, Trash2, Database, RefreshCw } from "lucide-react";
import {
  historyList, historyRemove, historyClear, historyPurgeMissing, historyApplyRetention,
  mediaPosList, mediaPosRemove, mediaPosClear,
  docPosList, docPosRemove, docPosClear,
  threedList, threedRemove, threedClear,
  archivePwdList, archivePwdRemove, archivePwdClear,
  type HistoryRow, type MediaPosRow, type DocPosRow, type ThreeDRow, type ArchivePwdRow,
} from "../lib/persist";
import { formatBytes, formatTime, formatDateTime, baseName } from "../lib/format";
import { useSettingsStore } from "../stores/settingsStore";
import { useGridStore } from "../stores/gridStore";
import { fileRefFromPath } from "../hooks/useOsDrop";

interface Props {
  open: boolean;
  onClose: () => void;
}

/** 统一的行形态(四类记录归一化后渲染) */
interface Row {
  path: string;
  summary: string;
  time: number;
  missing?: boolean;
}

const docSummary = (r: DocPosRow): string => {
  if (r.page != null) return `第 ${r.page + 1} 页`;
  if (r.scroll_y != null) return `滚动 ${Math.round(r.scroll_y)}px`;
  if (r.zoom != null) return `缩放/字号 ${Math.round(r.zoom * 100) / 100}`;
  return "已记录";
};

/**
 * 记录管理对话框(design.md §9.4,§交互修正-记录管理与历史合并):顶栏「历史」与设置「记录管理」
 * 已合并为这单一对话框/入口。五类本地记录(预览历史/播放位置/文档位置/3D 视角/压缩包密码 task2)
 * 按类型分组,支持单条删、勾选多条删、按类型清空、一键清理失效、保留策略(条数上限淘汰最旧);
 * 「预览历史」组保留原历史对话框的点击重开(进首空格,失效灰显不可点)。
 * 全部数据仅存本地;删除 db 文件即恢复出厂。入口:顶栏「历史」、设置 → 记录管理。
 */
export function RecordManagerDialog({ open, onClose }: Props) {
  const [history, setHistory] = useState<HistoryRow[] | null>(null);
  const [media, setMedia] = useState<MediaPosRow[] | null>(null);
  const [doc, setDoc] = useState<DocPosRow[] | null>(null);
  const [threed, setThreed] = useState<ThreeDRow[] | null>(null);
  const [archPwd, setArchPwd] = useState<ArchivePwdRow[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [notice, setNotice] = useState<string | null>(null);
  const historyRetention = useSettingsStore((s) => s.historyRetention);
  const setHistoryRetention = useSettingsStore((s) => s.setHistoryRetention);
  const placeFile = useGridStore((s) => s.placeFile);

  /** 预览历史点击重开(进首空格);失效记录不可点(调用方已挡) */
  const openFromHistory = useCallback(
    async (path: string) => {
      const ref = await fileRefFromPath(path).catch(() => null);
      if (!ref) return;
      placeFile(ref);
      onClose();
    },
    [placeFile, onClose]
  );

  const reload = useCallback(async () => {
    const [h, m, d, t, a] = await Promise.all([
      historyList().catch(() => [] as HistoryRow[]),
      mediaPosList().catch(() => [] as MediaPosRow[]),
      docPosList().catch(() => [] as DocPosRow[]),
      threedList().catch(() => [] as ThreeDRow[]),
      archivePwdList().catch(() => [] as ArchivePwdRow[]),
    ]);
    setHistory(h);
    setMedia(m);
    setDoc(d);
    setThreed(t);
    setArchPwd(a);
  }, []);

  useEffect(() => {
    if (!open) return;
    setSelected(new Set());
    setNotice(null);
    void reload();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, reload]);

  // 打开时顺手执行一次保留策略(淘汰超出上限的最旧历史)
  useEffect(() => {
    if (open) void historyApplyRetention(historyRetention).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  const groups: { id: string; title: string; rows: Row[] | null; remove: (p: string) => Promise<void>; clear: () => Promise<void>; onOpen?: (p: string) => void }[] = [
    {
      id: "history",
      title: "预览历史",
      rows: history?.map((r) => ({
        path: r.path,
        summary: `${formatBytes(r.size)} · 打开 ${r.open_count} 次`,
        time: r.last_opened,
        missing: r.missing,
      })) ?? null,
      remove: historyRemove,
      clear: historyClear,
      onOpen: (p) => void openFromHistory(p),
    },
    {
      id: "media",
      title: "播放位置",
      rows: media?.map((r) => ({
        path: r.path,
        summary: `播到 ${formatTime(r.position)}${r.duration ? ` / ${formatTime(r.duration)}` : ""}`,
        time: r.updated_at,
      })) ?? null,
      remove: mediaPosRemove,
      clear: mediaPosClear,
    },
    {
      id: "doc",
      title: "文档位置",
      rows: doc?.map((r) => ({ path: r.path, summary: docSummary(r), time: r.updated_at })) ?? null,
      remove: docPosRemove,
      clear: docPosClear,
    },
    {
      id: "threed",
      title: "3D 视角",
      rows: threed?.map((r) => ({ path: r.path, summary: "相机参数", time: r.updated_at })) ?? null,
      remove: threedRemove,
      clear: threedClear,
    },
    {
      id: "archive_pwd",
      title: "压缩包密码",
      rows: archPwd?.map((r) => ({ path: r.path, summary: "已记住密码", time: r.updated_at })) ?? null,
      remove: archivePwdRemove,
      clear: archivePwdClear,
    },
  ];

  const key = (gid: string, path: string) => `${gid}:${path}`;
  const toggle = (gid: string, path: string, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(key(gid, path));
      else next.delete(key(gid, path));
      return next;
    });
  const toggleGroup = (gid: string, rows: Row[], on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      for (const r of rows) {
        if (on) next.add(key(gid, r.path));
        else next.delete(key(gid, r.path));
      }
      return next;
    });

  const afterMutation = async (msg?: string) => {
    if (msg) setNotice(msg);
    await reload();
  };

  const removeSelected = async () => {
    const jobs: Promise<unknown>[] = [];
    for (const k of selected) {
      const i = k.indexOf(":");
      const gid = k.slice(0, i);
      const path = k.slice(i + 1);
      const g = groups.find((x) => x.id === gid);
      if (g) jobs.push(g.remove(path).catch(() => {}));
    }
    await Promise.all(jobs);
    setSelected(new Set());
    await afterMutation(`已删除 ${jobs.length} 条记录`);
  };

  const purgeMissing = async () => {
    const n = await historyPurgeMissing().catch(() => 0);
    await afterMutation(n > 0 ? `已清理 ${n} 条失效记录` : "没有失效记录");
  };

  const applyRetention = async () => {
    const n = await historyApplyRetention(historyRetention).catch(() => 0);
    await afterMutation(n > 0 ? `已按上限淘汰 ${n} 条最旧历史` : "历史未超上限");
  };

  const clearAll = async () => {
    await Promise.all(groups.map((g) => g.clear().catch(() => {})));
    setSelected(new Set());
    await afterMutation("已清空全部记录");
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="flex max-h-[76vh] w-[600px] flex-col rounded-lg border border-line bg-panel shadow-2xl">
        {/* 头部 */}
        <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
          <h2 className="flex items-center gap-2 text-sm font-medium">
            <Database size={15} className="text-text-dim" />
            记录管理
          </h2>
          <div className="flex items-center gap-2">
            <button
              className="flex items-center gap-1 rounded px-2 py-1 text-xs text-text-dim hover:bg-panel-2 hover:text-text"
              onClick={() => void reload()}
              title="重新加载"
            >
              <RefreshCw size={13} />
            </button>
            <button className="text-text-dim hover:text-text" onClick={onClose}>
              <X size={16} />
            </button>
          </div>
        </div>

        {/* 工具条:删除选中 / 清理失效 / 保留策略 / 全部清空 */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line px-4 py-2 text-xs">
          <button
            className="rounded bg-brand/20 px-2.5 py-1 text-brand-bright enabled:hover:bg-brand/40 disabled:opacity-40"
            disabled={selected.size === 0}
            onClick={() => void removeSelected()}
          >
            删除选中{selected.size > 0 ? `(${selected.size})` : ""}
          </button>
          <button className="rounded px-2.5 py-1 text-text-dim hover:bg-panel-2 hover:text-text" onClick={() => void purgeMissing()}>
            清理失效记录
          </button>
          <span className="flex items-center gap-1.5 text-text-dim">
            历史保留
            <input
              type="number"
              min={1}
              className="w-16 rounded border border-line bg-panel-2 px-1.5 py-0.5 text-right outline-none"
              value={historyRetention}
              onChange={(e) => setHistoryRetention(Number(e.target.value))}
            />
            条
            <button className="rounded px-2 py-0.5 hover:bg-panel-2 hover:text-text" onClick={() => void applyRetention()}>
              应用
            </button>
          </span>
          <button className="ml-auto rounded px-2.5 py-1 text-danger/90 hover:bg-danger/15" onClick={() => void clearAll()}>
            全部清空
          </button>
        </div>

        {notice && <div className="border-b border-line bg-panel-2/50 px-4 py-1.5 text-xs text-text-dim">{notice}</div>}

        {/* 分组列表 */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {groups.map((g) => {
            const rows = g.rows;
            const allChecked = rows != null && rows.length > 0 && rows.every((r) => selected.has(key(g.id, r.path)));
            return (
              <section key={g.id} className="border-b border-line/60 last:border-b-0">
                <div className="sticky top-0 z-10 flex items-center justify-between bg-panel-2 px-4 py-1.5">
                  <label className="flex items-center gap-2 text-xs font-medium">
                    <input
                      type="checkbox"
                      className="accent-brand-bright"
                      checked={allChecked}
                      onChange={(e) => rows && toggleGroup(g.id, rows, e.target.checked)}
                    />
                    {g.title}
                    <span className="font-normal text-text-dim">{rows?.length ?? "…"}</span>
                  </label>
                  <button
                    className="text-[11px] text-text-dim hover:text-danger disabled:opacity-40"
                    disabled={!rows || rows.length === 0}
                    onClick={() => void g.clear().then(() => afterMutation(`已清空「${g.title}」`))}
                  >
                    清空本类
                  </button>
                </div>
                {rows == null ? (
                  <div className="px-4 py-3 text-xs text-text-dim">加载中…</div>
                ) : rows.length === 0 ? (
                  <div className="px-4 py-3 text-xs text-text-dim/50">暂无记录</div>
                ) : (
                  rows.map((r) => (
                    <div key={r.path} className="group flex items-center gap-2 px-4 py-1.5 hover:bg-panel-2/60">
                      <input
                        type="checkbox"
                        className="shrink-0 accent-brand-bright"
                        checked={selected.has(key(g.id, r.path))}
                        onChange={(e) => toggle(g.id, r.path, e.target.checked)}
                      />
                      <div
                        className={`min-w-0 flex-1 ${r.missing ? "opacity-45" : ""} ${
                          g.onOpen && !r.missing ? "cursor-pointer" : ""
                        }`}
                        onClick={g.onOpen && !r.missing ? () => g.onOpen!(r.path) : undefined}
                        title={g.onOpen && !r.missing ? `${r.path}(点击重新打开)` : r.path}
                      >
                        <div className="flex items-center gap-1.5 text-xs">
                          <span className="truncate">{baseName(r.path)}</span>
                          {r.missing && (
                            <span className="shrink-0 rounded bg-danger/20 px-1 text-[10px] text-danger">已失效</span>
                          )}
                        </div>
                        <div className="truncate text-[11px] text-text-dim/60" title={r.path}>
                          {r.path}
                        </div>
                      </div>
                      <div className="shrink-0 text-right text-[11px] text-text-dim">
                        <div>{r.summary}</div>
                        <div className="text-text-dim/50">{formatDateTime(r.time)}</div>
                      </div>
                      <button
                        className="shrink-0 rounded p-1 text-text-dim opacity-0 hover:bg-panel-2 hover:text-danger group-hover:opacity-100"
                        title="删除该记录"
                        onClick={() => void g.remove(r.path).then(() => afterMutation())}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ))
                )}
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}
