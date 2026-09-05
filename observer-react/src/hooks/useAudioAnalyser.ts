import { useEffect, useState } from "react";
import type { RefObject } from "react";

/**
 * 媒体元素 → Web Audio 分析链(element → analyser → destination)。
 * 供实时可视化用(SpectrumBars 柱形频谱)。注意:
 * - 每个媒体元素只能 createMediaElementSource 一次 → 按元素 WeakMap 缓存 source 节点
 *   (流式 seek 只换 src 不换元素,分析不中断;换文件重挂载 → 新元素新 source)。
 * - 跨域媒体(asset://、127.0.0.1 流)需元素带 crossOrigin="anonymous",
 *   两类服务端都已带 Access-Control-Allow-Origin。
 * - 元素一旦接入 Web Audio,输出走 AudioContext;WebView 自动播放策略下 context 可能
 *   suspended → 播放时 resume。
 * - 音量在元素上(pre-source)生效:静音/音量 0 时分析数据也是静默,柱形落到基准。
 */

let sharedCtx: AudioContext | null = null;
function getCtx(): AudioContext | null {
  if (sharedCtx) return sharedCtx;
  try {
    sharedCtx = new AudioContext();
  } catch {
    return null; // Web Audio 不可用 → 调用方静态兜底
  }
  return sharedCtx;
}

const sourceMap = new WeakMap<HTMLMediaElement, MediaElementAudioSourceNode>();

/**
 * 把 mediaRef 指向的 <audio>/<video> 接入分析链,返回 AnalyserNode(未就绪/不可用为 null)。
 * enabled=false 时不接入(视频格不需要实时分析,避免无谓接管输出)。
 */
export function useAudioAnalyser<T extends HTMLMediaElement>(
  mediaRef: RefObject<T | null>,
  enabled: boolean
): AnalyserNode | null {
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const el = mediaRef.current;
    const ctx = getCtx();
    if (!el || !ctx) return;
    let src = sourceMap.get(el);
    if (!src) {
      try {
        src = ctx.createMediaElementSource(el);
        sourceMap.set(el, src);
      } catch {
        return;
      }
    }
    const an = ctx.createAnalyser();
    an.fftSize = 2048;
    an.smoothingTimeConstant = 0.8;
    src.connect(an);
    an.connect(ctx.destination);
    // context 起始可能 suspended(无手势创建):立即 + 每次播放时 resume
    const resume = () => void ctx.resume().catch(() => {});
    resume();
    el.addEventListener("play", resume);
    setAnalyser(an);
    return () => {
      el.removeEventListener("play", resume);
      try {
        src.disconnect(an);
        an.disconnect();
      } catch {
        // 节点已随元素销毁,忽略
      }
      setAnalyser(null);
    };
  }, [mediaRef, enabled]);

  return analyser;
}
