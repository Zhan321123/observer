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
import { useOsDrop } from "./hooks/useOsDrop";
import { useMediaKeys } from "./hooks/useMediaKeys";
import { bootstrap, startPersistence } from "./lib/persistence";

/**
 * 六区布局(layout.md §1):
 *   顶栏(固定条)
 *   文件 frame(左,宽可调)| 预览 frame(自适应)+ 功能 frame(底部固定条)| 右栏(宽可调)
 *   右栏内部:文件信息(上)/ 格式转换(下),分割线可上下拖
 * frame 只能拖边框调大小,不能换位移动(§1 规则)。
 *
 * 启动先 bootstrap() 还原宫格全景/当前文件夹(SQLite),ready 后再渲染,避免默认桌面页闪跳。
 */
export default function App() {
  useOsDrop();
  useMediaKeys();
  const [ready, setReady] = useState(false);

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

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <TopBar />

      <Group orientation="horizontal" className="min-h-0 flex-1">
        {/* 文件 frame(左):宽度可调 */}
        <Panel defaultSize="20%" minSize="13%" maxSize="40%" className="min-w-0">
          <FileTreePanel />
        </Panel>
        <Separator className="sep-h" />

        {/* 中央:预览 frame(自适应)+ 功能 frame(底部固定,不可调) */}
        <Panel minSize="30%" className="min-w-0">
          <div className="flex h-full flex-col">
            <div className="min-h-0 flex-1">
              <PreviewGrid />
            </div>
            <FunctionBar />
          </div>
        </Panel>
        <Separator className="sep-h" />

        {/* 右栏:文件信息(上)/ 格式转换(下),两者同宽,分割线上下拖 */}
        <Panel defaultSize="22%" minSize="15%" maxSize="40%" className="min-w-0">
          <Group orientation="vertical">
            <Panel defaultSize="55%" minSize="20%">
              <FileInfoPanel />
            </Panel>
            <Separator className="sep-v" />
            <Panel minSize="15%">
              <ConvertPanel />
            </Panel>
          </Group>
        </Panel>
      </Group>

      {/* 全界面 / 全屏显示覆盖层(§4.6) */}
      <FullViewOverlay />
      {/* 内部拖拽跟随游标(pointer-based) */}
      <DragGhost />
      {/* 自绘右键菜单(全局) */}
      <ContextMenu />
    </div>
  );
}
