import { useState } from "react";
import { Settings, History, Shapes } from "lucide-react";
import { GridSizePicker } from "./GridSizePicker";
import { SettingsDialog } from "./SettingsDialog";
import { RecordManagerDialog } from "./RecordManagerDialog";
import { SupportedTypesDialog } from "./SupportedTypesDialog";
import logo from "../assets/observer.png";

/** 顶栏 frame(§2):logo + 宫格选择 + 适配类型 + 历史 + 设置入口。 */
export function TopBar() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [typesOpen, setTypesOpen] = useState(false);

  return (
    <header className="flex h-10 shrink-0 items-center gap-2 border-b border-line bg-panel px-3">
      <img src={logo} alt="Observer" className="h-6 w-6 object-contain" />
      <span className="mr-2 text-sm font-semibold tracking-wide text-text">Observer</span>

      <GridSizePicker />

      <div className="flex-1" />

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
