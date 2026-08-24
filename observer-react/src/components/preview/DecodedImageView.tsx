import { useEffect, useState } from "react";
import { decodeImage, assetUrl, allowAssetPath } from "../../lib/tauri";
import { useCellViewStore } from "../../stores/cellViewStore";
import { ImageView } from "./ImageView";
import type { PreviewProps } from "../../formats/types";

/**
 * Rust 解码图片预览(M2,method.md §5):tiff/tga/exr/dds/qoi/hdr/psd/psb。
 * 挂载时调 `decode_image` → Rust 解码 → 磁盘缓存 PNG,再经 asset:// 交给 ImageView
 * 渲染(复用其滚轮缩放/拖拽平移/doc_position 持久化,持久化键仍为原 file.path)。
 */
export function DecodedImageView(props: PreviewProps) {
  const { file, cellId } = props;
  const [png, setPng] = useState<string | null>(null);
  const setView = useCellViewStore((s) => s.setView);

  useEffect(() => {
    let cancelled = false;
    setPng(null);
    void (async () => {
      try {
        const p = await decodeImage(file.path);
        await allowAssetPath(p).catch(() => {}); // 运行时授权(asset scope 已宽放行,双保险)
        if (!cancelled) setPng(p);
      } catch (e) {
        if (!cancelled) setView(cellId, { error: String(e) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [file.path, cellId, setView]);

  if (!png) {
    return (
      <div className="flex h-full w-full items-center justify-center text-xs text-text-dim">
        解码中…
      </div>
    );
  }
  return <ImageView {...props} overrideSrc={assetUrl(png)} />;
}
