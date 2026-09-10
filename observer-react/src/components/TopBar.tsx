import { useState } from "react";
import { Settings, History, Shapes, LayoutGrid, ListMusic, Music2 } from "lucide-react";
import { GridSizePicker } from "./GridSizePicker";
import { SettingsDialog } from "./SettingsDialog";
import { RecordManagerDialog } from "./RecordManagerDialog";
import { SupportedTypesDialog } from "./SupportedTypesDialog";
import { useUiStore } from "../stores/uiStore";
import { usePlayerStore } from "../stores/playerStore";
import logo from "../assets/observer.png";

/** 顶栏 frame(§2):logo + 宫格选择 + 页面切换(预览/播放器)+ 适配类型 + 历史 + 设置入口。 */
export function TopBar() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [typesOpen, setTypesOpen] = useState(false);
  const page = useUiStore((s) => s.page);
  const setPage = useUiStore((s) => s.setPage);
  // 宫格页的"正在播放"指示(播放器页自身无需);曲目名只在切曲时变化,不随 timeupdate 重渲
  const playerPlaying = usePlayerStore((s) => s.playing);
  const playerTrackName = usePlayerStore((s) => (s.index >= 0 ? s.queue[s.index]?.name ?? null : null));

  return (
    <header className="flex h-10 shrink-0 items-center gap-2 border-b border-line bg-panel px-3">
      <img src={logo} alt="Observer" className="h-6 w-6 object-contain" />
      <span className="mr-2 text-sm font-semibold tracking-wide text-text">Observer</span>

      {page === "grid" && <GridSizePicker />}

      <div className="flex-1" />

      {/* 宫格页播放中:♪ 指示,点击跳回播放器页 */}
      {page === "grid" && playerPlaying && (
        <button
          className="flex min-w-0 items-center gap-1.5 rounded bg-brand/20 px-2 py-1 text-xs text-brand-bright hover:bg-brand/30"
          onClick={() => setPage("player")}
          title={playerTrackName ? `正在播放:${playerTrackName}(点击返回播放器)` : "正在播放(点击返回播放器)"}
        >
          <span className="animate-pulse">
            <Music2 size={13} />
          </span>
          <span className="max-w-44 truncate">{playerTrackName ?? "正在播放"}</span>
        </button>
      )}

      {/* 页面切换:宫格预览 ⟷ 播放器(播放引擎常驻,切页不断播) */}
      <button
        className="flex items-center gap-1.5 rounded px-2 py-1 text-xs text-text hover:bg-panel-2"
        onClick={() => setPage(page === "player" ? "grid" : "player")}
        title={page === "player" ? "返回宫格预览(播放不停)" : "播放器:播放当前文件夹(含子文件夹)全部音频"}
      >
        {page === "player" ? <LayoutGrid size={15} /> : <ListMusic size={15} />}
        {page === "player" ? "预览" : "播放器"}
      </button>

      <button
        className="flex items-center gap-1.5 rounded px-2 py-1 text-xs text-text hover:bg-panel-2"
        onClick={() => setTypesOpen(true)}
        title="已适配的文件类型"
      >
        <Shapes size={15} />
        适配类型
      </button>

      {/* 历史(§交互修正):与设置内记录管理合并为单一对话框,此处打开合并后的记录管理 */}
      <button
        className="flex items-center gap-1.5 rounded px-2 py-1 text-xs text-text hover:bg-panel-2"
        onClick={() => setHistoryOpen(true)}
        title="预览历史 / 记录管理"
      >
        <History size={15} />
        历史
      </button>

      <button
        className="flex items-center gap-1.5 rounded px-2 py-1 text-xs text-text hover:bg-panel-2"
        onClick={() => setSettingsOpen(true)}
        title="设置"
      >
        <Settings size={15} />
        设置
      </button>

      <SupportedTypesDialog open={typesOpen} onClose={() => setTypesOpen(false)} />
      <RecordManagerDialog open={historyOpen} onClose={() => setHistoryOpen(false)} />
      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </header>
  );
}
