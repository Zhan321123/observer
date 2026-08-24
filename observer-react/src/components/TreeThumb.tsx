import { useEffect, useState } from "react";
import { File as FileIcon } from "lucide-react";
import { videoThumbnail, assetUrl, allowAssetPath } from "../lib/tauri";

// 进程内缩略图缓存(path → asset URL),避免重复调 ffmpeg / 滚动时闪烁。
const cache = new Map<string, string>();

/**
 * 文件树视频海报帧(M1 接入 UI):行首次可见时调 `video_thumbnail`(磁盘缓存)生成海报帧,
 * 经 asset:// 显示为小图;生成中/失败回退文件图标。配合虚拟滚动只渲染可见行 → 天然懒加载。
 */
export function TreeThumb({ path }: { path: string }) {
  const [url, setUrl] = useState<string | null>(() => cache.get(path) ?? null);

  useEffect(() => {
    if (url) return;
    let cancelled = false;
    void (async () => {
      try {
        const png = await videoThumbnail(path); // 默认取 1s 帧(后端按秒分桶缓存)
        await allowAssetPath(png).catch(() => {});
        const u = assetUrl(png);
        cache.set(path, u);
        if (!cancelled) setUrl(u);
      } catch {
        // 截图失败保持图标
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [path, url]);

  if (!url) return <FileIcon size={13} className="shrink-0" />;
  return (
    <img src={url} alt="" draggable={false} className="h-4 w-7 shrink-0 rounded-sm object-cover" />
  );
}
