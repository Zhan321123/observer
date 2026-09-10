import { useEffect, useRef } from "react";
import {
  allowAssetPath,
  assetUrl,
  ffprobeMeta,
  midiRender,
  streamBaseUrl,
  streamUrl,
} from "../../lib/tauri";
import { mediaPosGet, mediaPosSet } from "../../lib/persist";
import { clamp } from "../../lib/format";
import { useAudioAnalyser } from "../../hooks/useAudioAnalyser";
import { usePlayerStore } from "../../stores/playerStore";
import { useUiStore } from "../../stores/uiStore";
import { useFolderStore } from "../../stores/folderStore";
import { useCellViewStore } from "../../stores/cellViewStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { getControl } from "../../stores/cellControls";
import { MIDI_AUDIO_EXTS, STREAM_AUDIO_EXTS } from "../../formats/handlers/audio";
import { registerEngine } from "./engineLink";

/**
 * 常驻播放引擎(挂在 App 根部、页面结构之外 → 播放器↔宫格切页不断播)。
 * - 单个永不重建的 <audio>:createMediaElementSource 每元素仅一次,useAudioAnalyser 的
 *   WeakMap 复用 source → 切曲/切页分析图不断。禁止给元素加 key、禁止条件渲染本组件。
 * - 三路:原生(asset:// 直放)/ FFmpeg loopback 流(seek=改 t 参数重启流;src 延迟到
 *   首次 play/seek 才挂,恢复未播不空挂 ffmpeg)/ MIDI(rustysynth 合成 wav)。
 * - 每曲 position/volume/rate 走 media_position(与宫格共用):播放中 5s 节流 + pause/切曲
 *   精确保存;自然播完写 0(事件序 pause→ended,ended 确定性覆盖 pause 写入的 ≈duration)。
 * - 与宫格互斥:任一方起播暂停对方(只对 playing false→true 反应,无回环);
 *   播放器不占宫格媒体配额(useMediaQuota 只看 cellViewStore,有意的不对称)。
 * - StrictMode 双挂载:全部副作用幂等 + 完整清理(buildQueue 防重入、注册/注销对称)。
 */

/** 流服务基址:端口随进程固定,生命周期内只取一次;解析值缓存供同步使用 */
let streamBasePromise: Promise<string> | null = null;
const streamBase = () => (streamBasePromise ??= streamBaseUrl());

export function PlayerEngine() {
  const audioRef = useRef<HTMLAudioElement>(null);
  // posRef 供引擎主体与卸载保险共享的进度快照(5s 节流 + 精确保存的唯一事实)
  const posRef = useRef<{ path: string; t: number; d: number; v: number; r: number } | null>(null);
  const lastSaveRef = useRef(0);

  const analyser = useAudioAnalyser(audioRef, true);
  const setAnalyser = usePlayerStore((s) => s.setAnalyser);
  const page = useUiStore((s) => s.page);
  const rootPath = useFolderStore((s) => s.rootPath);

  // 频谱数据源:引擎建图即写入 store,播放器页订阅(切页频谱无缝恢复)
  useEffect(() => {
    setAnalyser(analyser);
    return () => setAnalyser(null);
  }, [analyser, setAnalyser]);

  // 宫格起播(playing false→true 沿)→ 暂停播放器(配额执行器产生的 playing→false 不会反向误触发)
  useEffect(
    () =>
      useCellViewStore.subscribe((s, prev) => {
        if (!usePlayerStore.getState().playing) return;
        for (const [k, v] of Object.entries(s.views)) {
          if (v.playing && !prev.views[Number(k)]?.playing) {
            usePlayerStore.getState().pause();
            break;
          }
        }
      }),
    []
  );

  // 播放器起播 → 暂停宫格全部在播媒体格(控制注册表与 FullViewOverlay 共享,全屏格天然覆盖)
  useEffect(
    () =>
      usePlayerStore.subscribe((s, prev) => {
        if (!s.playing || prev.playing) return;
        const views = useCellViewStore.getState().views;
        for (const k of Object.keys(views)) {
          if (views[Number(k)]?.playing) getControl(Number(k))?.pause?.();
        }
      }),
    []
  );

  // 引擎主体:全部动作经 effect 局部变量 + getState(事件时读取,无过期闭包)
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;

    // 引擎内部瞬态
    let loadToken = 0; // 加载代数:快速切曲时旧 await 链熔断
    let wantPlay = false; // 起播意愿(loadTrack autoplay / seek 重启续播 / loading 期 play)
    let offset = 0; // 流当前段起始偏移(绝对时间 = offset + el.currentTime)
    let duration = 0; // 时长(流走 ffprobe,不依赖元素)
    let streamAttached = false; // 流曲是否已挂 src(延迟到首次 play/seek)
    let streamBaseVal: string | null = null;
    let pendingSeek: number | null = null; // 加载期用户 seek 的目标(loadTrack 完成后应用)
    let persisted: { t: number; v: number | null; r: number | null } | null = null;
    let failStreak = 0; // 连续加载失败(MIDI 缺 sf2 等):≥ 队列长 → 停,防死循环;成功清零
    let suppressErr = false; // detach 引发的 abort 不报错误

    const st = () => usePlayerStore.getState();
    const track = () => {
      const s = st();
      return s.index >= 0 ? (s.queue[s.index] ?? null) : null;
    };

    const saveNow = () => {
      const p = posRef.current;
      if (p && p.d > 0) void mediaPosSet(p.path, p.t, p.d, p.v, p.r).catch(() => {});
    };

    const sync = () => {
      const s = st();
      const tr = track();
      if (!tr) return;
      const stream = s.srcKind === "stream";
      // 换曲窗口守卫:原生/合成在 metadata 就绪前 duration=NaN,不写 posRef(防新曲 0 位置脏存)
      if (!stream && !Number.isFinite(el.duration)) return;
      const t = stream ? offset + el.currentTime : el.currentTime;
      const d = stream ? duration : el.duration;
      posRef.current = { path: tr.path, t, d, v: el.volume, r: el.playbackRate };
      usePlayerStore.setState({
        currentTime: t,
        duration: d,
        volume: el.volume,
        rate: el.playbackRate,
        playing: !el.paused,
      });
      const now = Date.now();
      if (!el.paused && now - lastSaveRef.current > 5000) {
        lastSaveRef.current = now;
        saveNow();
      }
    };

    /** 挂流(起 ffmpeg):偏移进 URL t 参数;音量/倍速即刻应用(不依赖 metadata) */
    const attachStream = (startAt: number) => {
      const tr = track();
      if (!streamBaseVal || !tr) return;
      offset = startAt;
      el.src = streamUrl(streamBaseVal, tr.path, offset);
      streamAttached = true;
      el.volume = clamp(st().volume, 0, 1);
      el.playbackRate = st().rate;
    };

    const playInternal = () => {
      wantPlay = true;
      void el.play().catch((e) => usePlayerStore.setState({ error: `无法播放:${String(e)}` }));
    };

    /** 原生/合成的 loadedmetadata:应用持久化音量/倍速/位置,按需起播 */
    const onLoaded = () => {
      const s = st();
      if (s.srcKind === "stream") return; // 流:偏移在 URL t 参数,音量/倍速挂载时已应用
      el.volume = clamp(persisted?.v ?? useSettingsStore.getState().defaultVolume, 0, 1);
      el.playbackRate = persisted?.r ?? 1;
      const dur = Number.isFinite(el.duration) ? el.duration : 0;
      const persistedT = persisted?.t ?? 0;
      // 加载期 seek 优先;持久化位置近似结尾(≥ dur-0.5)视为已播完 → 从头
      const target =
        pendingSeek ?? (dur > 0 && persistedT > 0 && persistedT < dur - 0.5 ? persistedT : 0);
      pendingSeek = null;
      if (dur > 0 && target > 0 && target < dur) el.currentTime = target;
      failStreak = 0;
      sync();
      if (wantPlay) playInternal();
    };

    const onEnded = () => {
      const s = st();
      const tr = track();
      if (!tr || s.queue.length === 0) return;
      // 自然播完写 0(事件序 pause→ended:pause 保存先写 ≈duration,这里确定性覆盖)
      const p = posRef.current;
      if (p && p.d > 0) {
        posRef.current = { ...p, t: 0 };
        void mediaPosSet(p.path, 0, p.d, p.v, p.r).catch(() => {});
      }
      if (s.order === "repeat-one") {
        if (s.srcKind === "stream") {
          attachStream(0); // 流已到尾,重挂 src 从头
        } else {
          el.currentTime = 0;
        }
        playInternal();
        return;
      }
      s.onEnded(); // store 步进 → loadTrack(autoplay)
    };

    const onErr = () => {
      if (suppressErr) return;
      const err = el.error;
      const reason: Record<number, string> = {
        1: "已中止",
        2: "网络/流服务异常(ffmpeg 进程退出或连接中断)",
        3: "解码失败",
        4: "源不受支持(可能被拦截或容器无法解析)",
      };
      usePlayerStore.setState({
        playing: false,
        error: `播放失败:${err ? `${reason[err.code] ?? "未知错误"}(code ${err.code})` : "未知错误"}`,
      });
    };

    /** 暂停:同步快照后精确保存 */
    const onPause = () => {
      sync();
      saveNow();
    };

    const loadTrack = (i: number, opts?: { autoplay?: boolean }) => {
      const tr = st().queue[i];
      if (!tr) return;
      const token = ++loadToken;
      saveNow(); // 旧曲终存(同步快照,先于任何换 src)
      posRef.current = null;
      wantPlay = opts?.autoplay ?? false;
      pendingSeek = null;
      persisted = null;
      streamAttached = false;
      offset = 0;
      duration = 0;
      suppressErr = false;
      if (opts?.autoplay === false) failStreak = 0; // 新队列(buildQueue):失败计数从零开始
      usePlayerStore.setState({
        index: i,
        currentTime: 0,
        duration: 0,
        playing: false,
        loading: true,
        error: null,
        waveformPath: null,
        srcKind: "native",
      });

      const ext = tr.ext.toLowerCase();
      const kind: "native" | "stream" | "midi" = STREAM_AUDIO_EXTS.includes(ext)
        ? "stream"
        : MIDI_AUDIO_EXTS.includes(ext)
          ? "midi"
          : "native";

      void (async () => {
        try {
          // 持久化恢复(位置/音量/倍速;三路共用)
          const pos = await mediaPosGet(tr.path).catch(() => null);
          if (token !== loadToken) return;
          persisted = pos ? { t: pos.position, v: pos.volume, r: pos.rate } : null;

          if (kind === "stream") {
            const meta = await ffprobeMeta(tr.path); // 时长不依赖元素
            if (token !== loadToken) return;
            streamBaseVal ??= await streamBase();
            if (token !== loadToken) return;
            duration = meta.duration ?? 0;
            // 起播偏移:加载期用户 seek > 持久化位置(近似结尾视为已播完 → 从头)
            let start = 0;
            const pt = persisted?.t ?? 0;
            if (pendingSeek != null) start = clamp(pendingSeek, 0, duration || pendingSeek);
            else if (pt > 0 && duration > 0 && pt < duration - 0.5) start = pt;
            pendingSeek = null;
            offset = start;
            usePlayerStore.setState({
              srcKind: "stream",
              duration,
              waveformPath: tr.path,
              currentTime: start,
              volume: persisted?.v ?? useSettingsStore.getState().defaultVolume,
              rate: persisted?.r ?? 1,
              loading: false,
            });
            failStreak = 0;
            if (wantPlay) {
              attachStream(start); // src 延迟挂载到此
              playInternal();
            }
            return; // 未播不挂 src(免空挂 ffmpeg);play()/seek() 负责挂载
          }

          let src: string;
          let waveform: string;
          if (kind === "midi") {
            const wav = await midiRender(tr.path);
            await allowAssetPath(wav).catch(() => {}); // 合成 wav 在缓存目录,授权范围外
            if (token !== loadToken) return;
            src = assetUrl(wav);
            waveform = wav;
          } else {
            void allowAssetPath(tr.path).catch(() => {}); // 双保险(目录授权已递归),不阻塞
            src = assetUrl(tr.path);
            waveform = tr.path;
          }
          el.src = src;
          usePlayerStore.setState({
            srcKind: kind,
            waveformPath: waveform,
            volume: persisted?.v ?? useSettingsStore.getState().defaultVolume,
            rate: persisted?.r ?? 1,
            loading: false,
          });
          // 位置恢复在 loadedmetadata(onLoaded)
        } catch (e) {
          if (token !== loadToken) return;
          failStreak++;
          const all = failStreak >= st().queue.length;
          usePlayerStore.setState({
            loading: false,
            playing: false,
            error: all ? "本轮所有曲目均无法加载,已停止" : `无法加载 ${tr.name}:${String(e)}`,
          });
          if (all) return;
          // 自动跳下一首(如 MIDI 缺 SoundFont);稍候避免错误一闪而过
          window.setTimeout(() => {
            if (token === loadToken) st().onEnded();
          }, 800);
        }
      })();
    };

    const play = () => {
      const s = st();
      if (s.index < 0 || s.queue.length === 0) return;
      failStreak = 0; // 用户主动起播:重置连续失败计数(自动跳过重新生效)
      if (s.loading) {
        wantPlay = true; // 加载完成后自动起播(onLoaded / 流路 wantPlay 分支)
        return;
      }
      if (s.srcKind === "stream" && !streamAttached) attachStream(offset);
      playInternal();
    };

    const pause = () => {
      wantPlay = false;
      el.pause();
    };

    const seek = (t: number) => {
      const s = st();
      const tr = track();
      if (!tr) return;
      const dur = s.srcKind === "stream" ? duration : el.duration;
      const c = clamp(t, 0, Number.isFinite(dur) && dur > 0 ? dur : t);
      if (s.loading) {
        pendingSeek = c; // 加载完成后应用(onLoaded / 流路起播偏移)
        usePlayerStore.setState({ currentTime: c });
        return;
      }
      if (s.srcKind === "stream") {
        wantPlay = !el.paused || wantPlay; // 重启后续播
        attachStream(c); // 改 t 重启流(挂载态换 src = 断旧起新 ffmpeg)
        usePlayerStore.setState({ currentTime: c });
        if (wantPlay) playInternal();
      } else {
        el.currentTime = c;
      }
    };

    const setVolume = (v: number) => {
      el.volume = clamp(v, 0, 1); // store 经 volumechange→sync 同步
    };

    const setRate = (r: number) => {
      el.playbackRate = r; // store 经 ratechange→sync 同步
    };

    const stopAndDetach = () => {
      loadToken++; // 在途加载失效
      wantPlay = false;
      suppressErr = true;
      el.pause();
      saveNow();
      posRef.current = null;
      streamAttached = false;
      offset = 0;
      duration = 0;
      el.removeAttribute("src");
      el.load(); // 断开 loopback(杀 ffmpeg);触发的 abort 被 suppressErr 吞掉
      usePlayerStore.setState({
        playing: false,
        currentTime: 0,
        duration: 0,
        loading: false,
        error: null,
        waveformPath: null,
      });
    };

    // 事件监听(常驻,完整清理)
    el.addEventListener("timeupdate", sync);
    el.addEventListener("play", sync);
    el.addEventListener("pause", onPause);
    el.addEventListener("volumechange", sync);
    el.addEventListener("ratechange", sync);
    el.addEventListener("loadedmetadata", onLoaded);
    el.addEventListener("ended", onEnded);
    el.addEventListener("error", onErr);

    const unregister = registerEngine({
      play,
      pause,
      seek,
      setVolume,
      setRate,
      loadTrack,
      stopAndDetach,
    });

    return () => {
      el.removeEventListener("timeupdate", sync);
      el.removeEventListener("play", sync);
      el.removeEventListener("pause", onPause);
      el.removeEventListener("volumechange", sync);
      el.removeEventListener("ratechange", sync);
      el.removeEventListener("loadedmetadata", onLoaded);
      el.removeEventListener("ended", onEnded);
      el.removeEventListener("error", onErr);
      saveNow();
      unregister();
    };
  }, []);

  // 队列编排:切文件夹 → 停止+清队列;播放器页 → 立即按新根目录重建;宫格页 → 懒(进页再建)。
  // 声明在引擎注册 effect 之后:挂载即建队列时 engine() 必已注册(不依赖 IPC 异步晚于挂载的时序巧合)。
  // 引擎在 bootstrap(内含 openFolder)之后才挂载,天然错过启动期的初始 openFolder。
  useEffect(() => {
    if (!rootPath) return;
    const st = usePlayerStore.getState();
    if (st.rootPath === rootPath) return; // 队列已对应此目录(含正在播)
    st.onRootChanged();
    if (page === "player") void usePlayerStore.getState().buildQueue(rootPath);
  }, [page, rootPath]);

  // 卸载/热重载保险终存(引擎常驻实际不走;StrictMode 双挂载时 posRef 多为 null 无害)
  useEffect(
    () => () => {
      const p = posRef.current;
      if (p && p.d > 0) void mediaPosSet(p.path, p.t, p.d, p.v, p.r).catch(() => {});
    },
    []
  );

  return <audio ref={audioRef} crossOrigin="anonymous" hidden />;
}
