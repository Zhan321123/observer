import { useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ChevronRight, ChevronDown, Folder, Lock } from "lucide-react";
import { KIND_ICON } from "../kindIcon";
import { kindForExt } from "../../formats/registry";
import {
  archiveList,
  archivePwdGet,
  archivePwdSet,
  type ArchiveEntry,
  type ArchiveErr,
} from "../../lib/tauri";
import { useCellViewStore } from "../../stores/cellViewStore";
import { registerControl } from "../../stores/cellControls";
import type { PreviewProps } from "../../formats/types";

/**
 * 压缩包目录树核心(task2 §3):ArchiveView(kind=archive)与 XlsxView 双身份
 * "压缩包目录"视角共用。外观类左侧文件树(可折叠 + 虚拟滚动 + 按类型分色图标),
 * 唯一交互差异:**文件行点击无任何动作**(不预览包内文件)。
 * 条目由后端 archive_list 只读中央目录/头返回;数据加密条目带锁标记、不弹密码框;
 * 头加密(rar -hp / 7z -mhe=on)→ 密码框视图(§4:先自动试已存密码,无感直出;
 * 失效/无存 → 密码框,已存则预填;验证成功才写库)。
 */

/** 行高(与文件树一致,供虚拟滚动 estimateSize) */
const ROW_H = 24;

interface ArcNode {
  name: string;
  /** 包内相对路径('/' 分隔) */
  path: string;
  isDir: boolean;
  size: number;
  mtime: number;
  encrypted: boolean;
  children: ArcNode[] | null;
}

/** 由扁平条目构建树:显式目录项与隐式父目录合并;每层目录在前、名称不区分大小写。 */
function buildTree(entries: ArchiveEntry[]): ArcNode[] {
  const root: ArcNode = { name: "", path: "", isDir: true, size: 0, mtime: 0, encrypted: false, children: [] };
  const dirs = new Map<string, ArcNode>([["", root]]);
  const mkdir = (p: string): ArcNode => {
    const hit = dirs.get(p);
    if (hit) return hit;
    const i = p.lastIndexOf("/");
    const parent = mkdir(i >= 0 ? p.slice(0, i) : "");
    const node: ArcNode = { name: p.slice(i + 1), path: p, isDir: true, size: 0, mtime: 0, encrypted: false, children: [] };
    parent.children!.push(node);
    dirs.set(p, node);
    return node;
  };
  for (const e of entries) {
    const p = e.path.replace(/\\/g, "/").replace(/\/+$/, ""); // 归一分隔符 + 去尾 /
    if (!p) continue;
    const i = p.lastIndexOf("/");
    const parent = i >= 0 ? mkdir(p.slice(0, i)) : root;
    if (e.is_dir) {
      if (!dirs.has(p)) {
        // 显式目录项(可能已被子路径隐式创建 → 保留即可)
        const node: ArcNode = { name: e.name || p.slice(i + 1), path: p, isDir: true, size: 0, mtime: e.mtime, encrypted: false, children: [] };
        parent.children!.push(node);
        dirs.set(p, node);
      }
    } else {
      parent.children!.push({
        name: e.name || p.slice(i + 1),
        path: p,
        isDir: false,
        size: e.size,
        mtime: e.mtime,
        encrypted: e.encrypted,
        children: null,
      });
    }
  }
  const sortRec = (n: ArcNode) => {
    n.children?.sort((a, b) =>
      a.isDir === b.isDir
        ? a.name.toLowerCase().localeCompare(b.name.toLowerCase())
        : a.isDir
          ? -1
          : 1
    );
    n.children?.forEach(sortRec);
  };
  sortRec(root);
  return root.children!;
}

/** 由文件名取小写扩展名(与后端 ext_of 口径一致) */
const extOf = (name: string) => {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i + 1).toLowerCase() : "";
};

/** 结构化错误 → 占位文案(仅终态错误用;密码类在组件内处理) */
const errText = (e: ArchiveErr): string => {
  switch (e.kind) {
    case "corrupted":
      return `压缩包损坏或格式异常${e.message ? `(${e.message})` : ""}`;
    case "header_encrypted":
      return "文件头已加密";
    case "wrong_password":
      return "密码错误";
    default:
      return e.message || "无法读取压缩包";
  }
};

interface FlatRow {
  node: ArcNode;
  depth: number;
}

/** 把展开的树扁平化为可见行数组(虚拟滚动的前提)。 */
function flatten(nodes: ArcNode[], depth: number, expanded: Set<string>, out: FlatRow[]) {
  for (const n of nodes) {
    out.push({ node: n, depth });
    if (n.isDir && expanded.has(n.path) && n.children) flatten(n.children, depth + 1, expanded, out);
  }
}

export function ArchiveTree({ file, cellId }: PreviewProps) {
  const setView = useCellViewStore((s) => s.setView);

  const [entries, setEntries] = useState<ArchiveEntry[] | null>(null);
  /** null=非密码态;{prefill}=密码框视图(已存密码则预填) */
  const [askPwd, setAskPwd] = useState<{ prefill: string | null } | null>(null);
  const [pwdInput, setPwdInput] = useState("");
  const [pwdError, setPwdError] = useState<string | null>(null);
  const [pwdChecking, setPwdChecking] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);

  const load = async (pwd: string | null) => {
    try {
      return { ok: true as const, list: await archiveList(file.path, pwd) };
    } catch (e) {
      return { ok: false as const, err: e as ArchiveErr };
    }
  };

  // 打开流程(task2 §4):无密码直开 → 头加密则自动试已存密码(无感)→ 密码框
  useEffect(() => {
    let cancelled = false;
    setEntries(null);
    setAskPwd(null);
    setPwdInput("");
    setPwdError(null);
    setExpanded(new Set());
    (async () => {
      const r = await load(null);
      if (cancelled) return;
      if (r.ok) {
        setEntries(r.list);
        return;
      }
      if (r.err.kind === "header_encrypted" || r.err.kind === "wrong_password") {
        const stored = await archivePwdGet(file.path).catch(() => null);
        if (cancelled) return;
        if (stored) {
          const r2 = await load(stored);
          if (cancelled) return;
          if (r2.ok) {
            setEntries(r2.list); // 已存密码仍有效 → 无感直出
            return;
          }
          // 密码已改 → 密码框预填旧密码
          setPwdInput(stored);
          setAskPwd({ prefill: stored });
          setPwdError("已记住的密码无效,请重新输入");
          return;
        }
        setAskPwd({ prefill: null });
        return;
      }
      // 损坏/不支持等终态错误 → 宫格错误占位(§8:不影响其他宫格)
      setView(cellId, { error: errText(r.err) });
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file.path, cellId]);

  // 密码提交:验证成功才写库并列出;错误内联提示
  const onSubmitPwd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pwdInput || pwdChecking) return;
    setPwdChecking(true);
    const r = await load(pwdInput);
    setPwdChecking(false);
    if (r.ok) {
      setAskPwd(null);
      setPwdError(null);
      setEntries(r.list);
      void archivePwdSet(file.path, pwdInput).catch(() => {});
    } else if (r.err.kind === "wrong_password" || r.err.kind === "header_encrypted") {
      setPwdError("密码错误,请重试");
    } else {
      setAskPwd(null);
      setView(cellId, { error: errText(r.err) });
    }
  };

  const toggleDir = (path: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  const tree = useMemo(() => (entries ? buildTree(entries) : null), [entries]);
  const flat = useMemo(() => {
    const out: FlatRow[] = [];
    if (tree) flatten(tree, 0, expanded, out);
    return out;
  }, [tree, expanded]);

  // 命令式控制(功能条"全部展开/全部闭合"):包内树纯内存,收集全部目录路径即可,无 IO。
  // 经 registerControl 键级合并,与宿主(XlsxView 双身份)的 toggleXlsxMode 共存。
  useEffect(
    () =>
      registerControl(cellId, {
        kind: file.kind,
        archiveExpandAll: () => {
          const dirs: string[] = [];
          const walk = (nodes: ArcNode[]) => {
            for (const n of nodes)
              if (n.isDir && n.children) {
                dirs.push(n.path);
                walk(n.children);
              }
          };
          if (tree) walk(tree);
          setExpanded(new Set(dirs));
        },
        archiveCollapseAll: () => setExpanded(new Set()),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cellId, file.kind, tree]
  );

  const virtualizer = useVirtualizer({
    count: flat.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_H,
    overscan: 12,
  });

  // 密码框视图(头加密)
  if (askPwd) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-3 p-4 text-center">
        <Lock size={28} className="text-amber-400/80" />
        <div className="text-sm text-text">文件头已加密</div>
        <div className="text-xs text-text-dim">需要密码才能列出目录;验证成功后密码将保存在本机</div>
        <form className="flex items-center gap-2" onSubmit={onSubmitPwd}>
          <input
            autoFocus
            type="password"
            value={pwdInput}
            onChange={(e) => setPwdInput(e.target.value)}
            placeholder="输入密码…"
            className="w-56 rounded border border-line bg-panel-2 px-2 py-1 text-sm text-text outline-none focus:border-brand"
          />
          <button
            type="submit"
            disabled={!pwdInput || pwdChecking}
            className="rounded bg-brand/20 px-3 py-1 text-sm text-brand-bright enabled:hover:bg-brand/40 disabled:opacity-40"
          >
            {pwdChecking ? "验证中…" : "解锁"}
          </button>
        </form>
        {pwdError && <div className="text-xs text-danger">{pwdError}</div>}
      </div>
    );
  }

  if (!tree) {
    return <div className="flex h-full w-full items-center justify-center text-text-dim">读取目录…</div>;
  }
  if (tree.length === 0) {
    return <div className="flex h-full w-full items-center justify-center text-text-dim">空压缩包</div>;
  }

  return (
    <div ref={scrollRef} className="h-full overflow-y-auto">
      <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
        {virtualizer.getVirtualItems().map((vi) => {
          const { node, depth } = flat[vi.index];
          const isDir = node.isDir;
          const open = expanded.has(node.path);
          return (
            <div
              key={node.path}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                height: ROW_H,
                transform: `translateY(${vi.start}px)`,
              }}
            >
              {isDir ? (
                // 文件夹行:点击 = 展开/折叠(唯一交互;文件行无任何动作)
                <button
                  className="flex h-full w-full items-center gap-1 rounded px-1 text-left text-xs text-text hover:bg-panel-2"
                  style={{ paddingLeft: `${8 + depth * 14}px` }}
                  onClick={() => toggleDir(node.path)}
                  title={node.path}
                >
                  {open ? (
                    <ChevronDown size={13} className="shrink-0 text-text-dim" />
                  ) : (
                    <ChevronRight size={13} className="shrink-0 text-text-dim" />
                  )}
                  <Folder size={13} className="shrink-0 text-brand-bright/80" />
                  <span className="truncate">{node.name}</span>
                </button>
              ) : (
                // 文件行:点击无动作(task2 §3,与左侧文件树的唯一交互差异)
                <div
                  className="flex h-full w-full cursor-default items-center gap-1 rounded px-1 text-left text-xs text-text-dim"
                  style={{ paddingLeft: `${8 + depth * 14}px` }}
                  title={node.encrypted ? `${node.path}(加密条目)` : node.path}
                >
                  <span className="w-[13px] shrink-0" />
                  {(() => {
                    const { Icon, cls } = KIND_ICON[kindForExt(extOf(node.name))] ?? KIND_ICON.unknown;
                    return <Icon size={13} className={`shrink-0 ${cls}`} />;
                  })()}
                  <span className="truncate">{node.name}</span>
                  {node.encrypted && <Lock size={11} className="ml-0.5 shrink-0 text-amber-400/70" />}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
