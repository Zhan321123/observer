//! M3 音频进阶(method.md §4):MIDI 经 rustysynth SoundFont 合成 → PCM → WAV 磁盘缓存,
//! 前端用原生 <audio> 播放(铁律 2:字节走 asset://,这里只传路径)。
//!
//! SoundFont 依赖说明:MIDI 合成必须有 .sf2。本应用不随包捆绑(体积/许可),按以下顺序发现:
//!   1. 环境变量 OBSERVER_SOUNDFONT(显式指向某个 .sf2)
//!   2. 可执行文件旁 / 旁路 bin 目录下的 soundfont.sf2
//!   3. 前端命令参数显式传入(预留设置项)
//! 均无 → 返回明确错误,前端显示"需要 SoundFont"占位。

use std::fs::File;
use std::io::BufReader;
use std::path::PathBuf;
use std::sync::Arc;

use rustysynth::{MidiFile, MidiFileSequencer, SoundFont, Synthesizer, SynthesizerSettings};

/// 合成采样率(CD 质量半速,体积/质量平衡)。
const SAMPLE_RATE: i32 = 44100;
/// 最长渲染时长(秒),防超长 MIDI 撑爆磁盘/内存。
const MAX_RENDER_SECS: f64 = 600.0;

/// 按优先级发现 SoundFont(.sf2)。
fn find_soundfont(explicit: Option<&str>) -> Option<PathBuf> {
    // 0. 前端显式传入
    if let Some(p) = explicit {
        let pb = PathBuf::from(p);
        if !p.is_empty() && pb.is_file() {
            return Some(pb);
        }
    }
    // 1. 环境变量
    if let Ok(p) = std::env::var("OBSERVER_SOUNDFONT") {
        let pb = PathBuf::from(p);
        if pb.is_file() {
            return Some(pb);
        }
    }
    // 2. 可执行文件旁 / 旁路 bin
    if let Ok(cur) = std::env::current_exe() {
        if let Some(dir) = cur.parent() {
            for cand in [dir.join("soundfont.sf2"), dir.join("bin").join("soundfont.sf2")] {
                if cand.is_file() {
                    return Some(cand);
                }
            }
        }
    }
    None
}

fn mtime_secs(meta: &std::fs::Metadata) -> i64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// 渲染 MIDI → WAV 磁盘缓存,返回路径(前端经 asset:// 播放,天然可 seek)。
/// 缓存 key = midi 路径+size+mtime + SoundFont 路径+mtime(SoundFont 换了自动重渲染)。
#[tauri::command]
pub fn midi_render(
    app: tauri::AppHandle,
    path: String,
    soundfont: Option<String>,
) -> Result<String, String> {
    use tauri::Manager;

    let sf2 = find_soundfont(soundfont.as_deref()).ok_or_else(|| {
        "未找到 SoundFont(.sf2):MIDI 需要 SoundFont 才能合成。请设置 OBSERVER_SOUNDFONT 环境变量指向某个 .sf2,或将 soundfont.sf2 放到应用目录后重试。".to_string()
    })?;

    // 缓存 key(含 SoundFont 标识,换了 SoundFont 结果不同)
    let key = format!("{:x}", {
        use std::hash::{Hash, Hasher};
        let mut h = std::collections::hash_map::DefaultHasher::new();
        path.hash(&mut h);
        let m = std::fs::metadata(&path).map_err(|e| format!("无法读取文件: {e}"))?;
        m.len().hash(&mut h);
        mtime_secs(&m).hash(&mut h);
        sf2.hash(&mut h);
        if let Ok(sm) = std::fs::metadata(&sf2) {
            mtime_secs(&sm).hash(&mut h);
        }
        h.finish()
    });
    let dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?
        .join("render");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let out = dir.join(format!("midi_{key}.wav"));
    if out.is_file() {
        return Ok(out.to_string_lossy().to_string());
    }

    // 加载 SoundFont + MIDI,合成 → 16-bit 立体声 WAV(分块写盘,不占大内存)
    let sound_font = {
        let mut r = BufReader::new(File::open(&sf2).map_err(|e| format!("无法打开 SoundFont: {e}"))?);
        Arc::new(SoundFont::new(&mut r).map_err(|e| format!("SoundFont 解析失败: {e}"))?)
    };
    let settings = SynthesizerSettings::new(SAMPLE_RATE);
    let synthesizer =
        Synthesizer::new(&sound_font, &settings).map_err(|e| format!("合成器初始化失败: {e}"))?;
    let midi = {
        let mut r = BufReader::new(File::open(&path).map_err(|e| format!("无法读取 MIDI: {e}"))?);
        Arc::new(MidiFile::new(&mut r).map_err(|e| format!("MIDI 解析失败: {e}"))?)
    };
    let mut sequencer = MidiFileSequencer::new(synthesizer);
    sequencer.play(&midi, false);

    let total = ((SAMPLE_RATE as f64) * midi.get_length().min(MAX_RENDER_SECS)) as usize;
    if total == 0 {
        return Err("MIDI 时长为 0".to_string());
    }

    let spec = hound::WavSpec {
        channels: 2,
        sample_rate: SAMPLE_RATE as u32,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };
    let mut writer =
        hound::WavWriter::create(&out, spec).map_err(|e| format!("WAV 创建失败: {e}"))?;
    const BLOCK: usize = (SAMPLE_RATE as usize) / 2; // 0.5s 一块
    let mut left = vec![0f32; BLOCK];
    let mut right = vec![0f32; BLOCK];
    let mut remaining = total;
    while remaining > 0 {
        let n = remaining.min(BLOCK);
        sequencer.render(&mut left[..n], &mut right[..n]);
        for i in 0..n {
            let l = (left[i].clamp(-1.0, 1.0) * 32767.0) as i16;
            let r = (right[i].clamp(-1.0, 1.0) * 32767.0) as i16;
            writer.write_sample(l).map_err(|e| format!("WAV 写入失败: {e}"))?;
            writer.write_sample(r).map_err(|e| format!("WAV 写入失败: {e}"))?;
        }
        remaining -= n;
    }
    writer.finalize().map_err(|e| format!("WAV 完成失败: {e}"))?;

    if out.is_file() {
        Ok(out.to_string_lossy().to_string())
    } else {
        Err("MIDI 渲染产物未生成".to_string())
    }
}
