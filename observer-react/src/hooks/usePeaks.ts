import { useEffect, useState } from "react";
import { audioWaveform } from "../lib/tauri";
import type { Peaks } from "../lib/waveformDraw";

/**
 * 波形峰值共享加载器(Waveform 主体 + WaveformSeekBar 进度条 + VideoSeekBar 共用)。
 * 后端固定 4096 桶(磁盘缓存),这里始终按 4096 请求:同一文件全 App 只解码一次,
 * 绘制端按像素宽自取桶(列 → 桶下标映射)。
 */

/** 会话缓存:path → 峰值(后端另有磁盘缓存,跨重启复用) */
const peakCache = new Map<string, Peaks>();
/** 在途请求去重:主体 + 进度条同 path 并发挂载只发一次 IPC */
const inflight = new Map<string, Promise<Peaks>>();

/** 全零峰值(无音轨视频/纯静音)→ 调用方回退普通进度条 */
export function isSilent(peaks: Peaks): boolean {
  return peaks.every(([mn, mx]) => mn === 0 && mx === 0);
}

export interface PeaksState {
  peaks: Peaks | null;
  /** 加载失败(无音频流/ffmpeg 缺失等)→ 回退普通进度条 */
  error: boolean;
  /** 峰值全零(无音轨/静音)→ 回退普通进度条 */
  silent: boolean;
}

export function usePeaks(path: string): PeaksState {
  const cached = peakCache.get(path);
  const [state, setState] = useState<PeaksState>(
    cached ? { peaks: cached, error: false, silent: isSilent(cached) } : { peaks: null, error: false, silent: false }
  );

  useEffect(() => {
    let cancelled = false;
    if (peakCache.has(path)) {
      const p = peakCache.get(path)!;
      setState({ peaks: p, error: false, silent: isSilent(p) });
      return;
    }
    setState({ peaks: null, error: false, silent: false });
    let promise = inflight.get(path);
    if (!promise) {
      promise = audioWaveform(path, 4096).then(
        (p) => {
          peakCache.set(path, p);
          return p;
        },
        (e) => {
          inflight.delete(path); // 失败不缓存,下次挂载可重试
          throw e;
        }
      );
      inflight.set(path, promise);
    }
    promise
      .then((p) => {
        if (!cancelled) setState({ peaks: p, error: false, silent: isSilent(p) });
      })
      .catch(() => {
        if (!cancelled) setState({ peaks: null, error: true, silent: false });
      });
    return () => {
      cancelled = true;
    };
  }, [path]);

  return state;
}
