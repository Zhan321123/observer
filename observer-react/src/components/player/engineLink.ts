/**
 * 播放引擎动作单槽注册(数据/动作分离,循 cellControls 先例):
 * PlayerEngine 常驻挂载时注册;playerStore 的 play/seek/next 等命令式动作经此转发。
 * 纯模块无状态,不进 zustand(AnalyserNode 等非序列化对象也不该进)。
 */
export interface PlayerEngineHandle {
  play(): void;
  pause(): void;
  seek(t: number): void;
  setVolume(v: number): void;
  setRate(r: number): void;
  loadTrack(i: number, opts?: { autoplay?: boolean }): void;
  /** 停止并摘除 src(暂停+终存+el.load() 断开 loopback/杀 ffmpeg) */
  stopAndDetach(): void;
}

let handle: PlayerEngineHandle | null = null;

export const registerEngine = (h: PlayerEngineHandle): (() => void) => {
  handle = h;
  return () => {
    if (handle === h) handle = null;
  };
};

export const engine = (): PlayerEngineHandle | null => handle;
