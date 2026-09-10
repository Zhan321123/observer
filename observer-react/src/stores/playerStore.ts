import { create } from "zustand";
import { collectAudioFiles } from "../lib/tauri";
import { playerQueueExts } from "../formats/handlers/audio";
import { engine } from "../components/player/engineLink";

/**
 * 播放器页数据态(§播放器):队列/顺序模式/引擎上报的瞬态。
 * 命令式播放动作经 engineLink 转发给常驻引擎(PlayerEngine,挂在页面结构之外 → 切页不断播),
 * 数据/动作分离循 cellViewStore/cellControls 先例。
 * - 队列与打开的根目录绑定:切文件夹 = 停止+清队列(引擎订阅 folderStore),播放器页上切则立即重建。
 * - 每曲 position/volume/rate 持久化复用 media_position(与宫格共用,引擎自理)。
 */

/** 播放顺序:seq/reverse 播完回绕;shuffle 整轮不重复、播完重洗(手动回绕本轮);repeat-one 仅自然结束循环 */
export type PlayOrder = "seq" | "reverse" | "shuffle" | "repeat-one";
/** 主区显示模式(与宫格音频预览 audioDisplay 同面) */
export type AudioDisplay = "bars" | "wave" | "none";

export interface PlayerTrack {
  path: string;
  name: string;
  ext: string;
}

/** 重启恢复:buildQueue 按该 path 定位当前曲(index 随文件夹内容变化不可靠,用后即清) */
let persistedTrackPath: string | null = null;
export const setPersistedTrackPath = (p: string | null) => {
  persistedTrackPath = p;
};

/** Fisher–Yates 洗牌:0..n-1 的随机排列(shuffle 整轮序) */
const shuffled = (n: number): number[] => {
  const a = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

interface PlayerState {
  /** 队列对应的根目录;"" = 无队列 */
  rootPath: string;
  queue: PlayerTrack[];
  /** collect 在途(防重入 + 页面骨架) */
  queueLoading: boolean;
  /** 当前曲下标;-1 = 无 */
  index: number;
  order: PlayOrder;
  display: AudioDisplay;
  /** shuffle 整轮序(queue 下标排列)与当前曲在轮中的位置 */
  shuffleOrder: number[];
  shufflePos: number;

  // ---- 引擎上报的瞬态 ----
  playing: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  rate: number;
  /** 曲目加载中(流元信息 / MIDI 合成) */
  loading: boolean;
  error: string | null;
  srcKind: "native" | "stream" | "midi";
  /** 波形取峰值路径(MIDI=合成 wav,其余=原文件) */
  waveformPath: string | null;
  /** 引擎挂载后写入(频谱数据源);非序列化对象,永不持久化 */
  analyser: AnalyserNode | null;
  /** 歌词预留:后续 { synced, offsetMs, lines } 等,本轮恒 null */
  lyrics: null;

  buildQueue(root: string): Promise<void>;
  /** 切文件夹:停止(引擎 detach)+ 清队列 */
  onRootChanged(): void;
  /** 自然播完步进(repeat-one 由引擎直接重播,不经此) */
  onEnded(): void;
  next(): void;
  prev(): void;
  jumpTo(i: number): void;
  play(): void;
  pause(): void;
  toggle(): void;
  seek(t: number): void;
  setVolume(v: number): void;
  setRate(r: number): void;
  setOrder(o: PlayOrder): void;
  setDisplay(m: AudioDisplay): void;
  setAnalyser(a: AnalyserNode | null): void;
  hydrate(p: { order?: PlayOrder; display?: AudioDisplay }): void;
}

export const usePlayerStore = create<PlayerState>((set, get) => {
  /**
   * 步进(纯顺序逻辑,引擎只消费):
   * dir=+1 前进 / -1 后退;natural=自然 ended(shuffle 轮尾重洗;手动越界回绕本轮不重洗)。
   * seq/repeat-one(手动)= 下标 +dir;reverse = 方向取反;shuffle = 沿本轮洗牌序。
   */
  const step = (dir: 1 | -1, natural: boolean): number => {
    const { queue, index, order, shufflePos } = get();
    const n = queue.length;
    if (n === 0) return -1;
    if (order !== "shuffle") {
      const sign = order === "reverse" ? -1 : 1;
      return (index + sign * dir + 2 * n) % n;
    }
    let pos = shufflePos + dir;
    if (pos >= n) {
      if (natural) {
        // 一轮播完 → 重洗(避免把刚播过的排回首位)
        let so = shuffled(n);
        while (n > 1 && so[0] === index) so = shuffled(n);
        set({ shuffleOrder: so });
      }
      pos = 0;
    }
    if (pos < 0) pos = n - 1;
    set({ shufflePos: pos });
    return get().shuffleOrder[pos];
  };
  /** 加载目标曲并起播(手动跳转/自然步进都自动播) */
  const load = (i: number) => engine()?.loadTrack(i, { autoplay: true });

  return {
    rootPath: "",
    queue: [],
    queueLoading: false,
    index: -1,
    order: "seq",
    display: "bars",
    shuffleOrder: [],
    shufflePos: 0,
    playing: false,
    currentTime: 0,
    duration: 0,
    volume: 1,
    rate: 1,
    loading: false,
    error: null,
    srcKind: "native",
    waveformPath: null,
    analyser: null,
    lyrics: null,

    buildQueue: async (root) => {
      if (get().queueLoading) return; // 防重入(StrictMode 双跑 / effect 双触发)
      set({ queueLoading: true });
      try {
        const files = await collectAudioFiles(root, playerQueueExts());
        const queue: PlayerTrack[] = files.map((f) => ({ path: f.path, name: f.name, ext: f.ext }));
        // 定位当前曲:重启恢复的 trackPath 命中 → 该曲;否则 seq/shuffle 首曲、reverse 尾曲
        let index = persistedTrackPath ? queue.findIndex((t) => t.path === persistedTrackPath) : -1;
        persistedTrackPath = null;
        if (index < 0) index = queue.length > 0 ? (get().order === "reverse" ? queue.length - 1 : 0) : -1;
        const so = shuffled(queue.length);
        set({
          rootPath: root,
          queue,
          index,
          queueLoading: false,
          shuffleOrder: so,
          shufflePos: Math.max(0, so.indexOf(index)),
          playing: false,
          currentTime: 0,
          duration: 0,
          error: null,
          loading: false,
        });
        if (index >= 0) engine()?.loadTrack(index, { autoplay: false }); // 恢复但保持暂停
      } catch (e) {
        persistedTrackPath = null;
        set({
          queueLoading: false,
          rootPath: "",
          queue: [],
          index: -1,
          error: `扫描音频失败:${String(e)}`,
        });
      }
    },

    onRootChanged: () => {
      engine()?.stopAndDetach();
      set({
        rootPath: "",
        queue: [],
        index: -1,
        shuffleOrder: [],
        shufflePos: 0,
        playing: false,
        currentTime: 0,
        duration: 0,
        error: null,
        loading: false,
        waveformPath: null,
      });
    },

    onEnded: () => {
      if (get().order === "repeat-one") return; // 引擎已直接重播
      const t = step(1, true);
      if (t >= 0) load(t);
    },
    next: () => {
      const t = step(1, false);
      if (t >= 0) load(t);
    },
    prev: () => {
      const t = step(-1, false);
      if (t >= 0) load(t);
    },
    jumpTo: (i) => {
      const { queue, order, shuffleOrder } = get();
      if (i < 0 || i >= queue.length) return;
      if (order === "shuffle") set({ shufflePos: Math.max(0, shuffleOrder.indexOf(i)) });
      load(i);
    },

    play: () => engine()?.play(),
    pause: () => engine()?.pause(),
    toggle: () => (get().playing ? get().pause() : get().play()),
    seek: (t) => engine()?.seek(t),
    setVolume: (v) => engine()?.setVolume(v),
    setRate: (r) => engine()?.setRate(r),

    setOrder: (o) =>
      set((s) => {
        // 切到 shuffle:没有整轮序(队列长度变过)则生成,并把当前位置对齐到当前曲
        if (o === "shuffle" && s.shuffleOrder.length !== s.queue.length) {
          const so = shuffled(s.queue.length);
          return { order: o, shuffleOrder: so, shufflePos: Math.max(0, so.indexOf(s.index)) };
        }
        return { order: o };
      }),
    setDisplay: (m) => set({ display: m }),
    setAnalyser: (a) => set({ analyser: a }),
    hydrate: (p) => set(p),
  };
});
