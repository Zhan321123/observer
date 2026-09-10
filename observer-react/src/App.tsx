import { useEffect, useState } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import { TopBar } from "./components/TopBar";
import { FileTreePanel } from "./components/FileTreePanel";
import { PreviewGrid } from "./components/PreviewGrid";
import { FunctionBar } from "./components/FunctionBar";
import { FileInfoPanel } from "./components/FileInfoPanel";
import { ConvertPanel } from "./components/ConvertPanel";
import { FullViewOverlay } from "./components/FullViewOverlay";
import { DragGhost } from "./components/DragGhost";
import { ContextMenu } from "./components/ContextMenu";
import { PlayerPage } from "./components/player/PlayerPage";
import { PlayerToolbar } from "./components/player/PlayerToolbar";
import { PlayerEngine } from "./components/player/PlayerEngine";
import { MiniPlayer } from "./components/player/MiniPlayer";
import { useUiStore } from "./stores/uiStore";
import { useOsDrop } from "./hooks/useOsDrop";
import { useMediaKeys } from "./hooks/useMediaKeys";
import { useMediaQuota } from "./hooks/useMediaQuota";
import { useThreeDQuota } from "./hooks/useThreeDQuota";
import { useMiniWindow } from "./hooks/useMiniWindow";
import { bootstrap, startPersistence } from "./lib/persistence";

/**
 * 六区布局(layout.md §1):
 *   顶栏(固定条)
 *   文件 frame(左,宽可调)| 预览 frame(自适应)+ 功能 frame(底部固定条)| 右栏(宽可调)
 *   右栏内部:文件信息(上)/ 格式转换(下),分割线可上下拖
 * frame 只能拖边框调大小,不能换位移动(§1 规则)。
 *
 * 播放器页(§播放器):应用内整页切换(uiStore.page,非路由)——左文件 frame 不变,
 * 中右两栏换成播放器主区+底部工具栏。播放引擎挂在页面结构之外,切页不断播。
 * 小窗模式(迭代二):主窗口缩小成迷你播放器(useMiniWindow 管缩窗/置顶/还原,尺寸持久化),
 * 渲染分支替换整个外壳,引擎仍在分支外常驻。
 *
 * 启动先 bootstrap() 还原宫格全景/当前文件夹(SQLite),ready 后再渲染,避免默认桌面页闪跳。
 */
export default function App() {
  useOsDrop();
  useMediaKeys();
  useMediaQuota();
  useThreeDQuota();
  useMiniWindow();
  const [ready, setReady] = useState(false);
  const page = useUiStore((s) => s.page);
  const mini = useUiStore((s) => s.mini);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await bootstrap();
      if (cancelled) return;
      startPersistence();
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!ready) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-text-dim">加载中…</div>
    );
  }

  // 小窗模式:整窗只剩迷你播放器(顶栏/文件 frame/宫格全部隐藏)
  if (mini) {
    return (
      <>
        <MiniPlayer />
        {/* 播放引擎(常驻,任何渲染分支之外 → 切小窗不断播) */}
        <PlayerEngine />
      </>
    );
  }

  return (
    <>
      <div className="flex h-full flex-col overflow-hidden">
        <TopBar />

      <Group orientation="horizontal" className="min-h-0 flex-1">
        {/* 文件 frame(左):宽度可调;两页共用,显式 id 保切页后左栏宽度稳定 */}
        <Panel id="files" defaultSize="20%" minSize="13%" maxSize="40%" className="min-w-0">
          <FileTreePanel />
        </Panel>
        <Separator className="sep-h" />

        {page === "player" ? (
          /* 播放器页:主区(可视化+队列)+ 底部工具栏;右栏(文件信息/转换)隐藏 */
          <Panel id="player" minSize="30%" className="min-w-0">
            <div className="flex h-full flex-col">
              <div className="min-h-0 flex-1">
                <PlayerPage />
              </div>
              <PlayerToolbar />
            </div>
          </Panel>
        ) : (
          <>
            {/* 中央:预览 frame(自适应)+ 功能 frame(底部固定,不可调) */}
            <Panel id="grid" minSize="30%" className="min-w-0">
              <div className="flex h-full flex-col">
                <div className="min-h-0 flex-1">
                  <PreviewGrid />
                </div>
                <FunctionBar />
              </div>
            </Panel>
            <Separator className="sep-h" />

            {/* 右栏:文件信息(上)/ 格式转换(下),两者同宽,分割线上下拖 */}
            <Panel id="right" defaultSize="22%" minSize="15%" maxSize="40%" className="min-w-0">
              <Group orientation="vertical">
                <Panel id="fileinfo" defaultSize="55%" minSize="20%">
                  <FileInfoPanel />
                </Panel>
                <Separator className="sep-v" />
                <Panel id="convert" minSize="15%">
                  <ConvertPanel />
                </Panel>
              </Group>
            </Panel>
          </>
        )}
      </Group>

      {/* 全界面 / 全屏显示覆盖层(§4.6) */}
      <FullViewOverlay />
      {/* 内部拖拽跟随游标(pointer-based) */}
      <DragGhost />
      {/* 自绘右键菜单(全局) */}
      <ContextMenu />
      </div>

      {/* 播放引擎(常驻,页面/小窗渲染分支之外 → 切页切小窗不断播;禁止条件渲染) */}
      <PlayerEngine />
    </>
  );
}
