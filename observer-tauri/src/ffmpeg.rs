//! FFmpeg 集成(M1,design.md §6/§7 + method.md §3)。
//!
//! 二进制解析顺序:环境变量(OBSERVER_FFMPEG/FFPROBE)→ 可执行文件旁(打包 sidecar)→ PATH。
//! 本机开发走 PATH;对外分发时在 OBSERVER_FFMPEG 指向或随包放置(并需处理 LGPL/GPL 许可,§11)。
//!
//! 流传输:Tauri 自定义协议要求整个响应体在内存(Cow<[u8]>),无法边转边播大文件,
//! 故按 §7 兜底方案起 127.0.0.1 loopback HTTP 服务(不过网卡、GB/s 内存拷贝),
//! ffmpeg stdout 直接作为响应体流式输出;seek = 杀旧进程带 `-ss` 重启(由前端改 URL 的 t 参数触发)。

use serde::Serialize;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdout, Command, Stdio};

// ---------- 二进制解析 ----------

fn which(name: &str) -> Option<PathBuf> {
    let exe = if cfg!(windows) { format!("{name}.exe") } else { name.to_string() };
    let path_var = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path_var) {
        let cand = dir.join(&exe);
        if cand.is_file() {
            return Some(cand);
        }
    }
    None
}

fn find_binary(name: &str) -> Option<PathBuf> {
    let exe = if cfg!(windows) { format!("{name}.exe") } else { name.to_string() };
    // 1. 环境变量
    if let Ok(p) = std::env::var(format!("OBSERVER_{}", name.to_uppercase())) {
        let pb = PathBuf::from(p);
        if pb.is_file() {
            return Some(pb);
        }
    }
    // 2. 可执行文件旁 / 旁路 bin(打包 sidecar 位置)
    if let Ok(cur) = std::env::current_exe() {
        if let Some(dir) = cur.parent() {
            for cand in [dir.join(&exe), dir.join("bin").join(&exe), dir.join("binaries").join(&exe)] {
                if cand.is_file() {
                    return Some(cand);
                }
            }
        }
    }
    // 3. PATH
    which(name)
    // None
}

pub fn ffmpeg_path() -> Result<PathBuf, String> {
    find_binary("ffmpeg").ok_or_else(|| {
        "未找到 ffmpeg(可设置 OBSERVER_FFMPEG 环境变量,或将 ffmpeg 置于 PATH/应用目录)".to_string()
    })
}
pub fn ffprobe_path() -> Result<PathBuf, String> {
    find_binary("ffprobe").ok_or_else(|| {
        "未找到 ffprobe(可设置 OBSERVER_FFPROBE 环境变量,或将 ffprobe 置于 PATH/应用目录)".to_string()
    })
}

// ---------- ffprobe 元信息 ----------

#[derive(Serialize, Default)]
pub struct VideoMeta {
    pub duration: Option<f64>,
    pub bit_rate: Option<i64>,
    pub format_name: Option<String>,
    pub video_codec: Option<String>,
    pub width: Option<i64>,
    pub height: Option<i64>,
    pub frame_rate: Option<f64>,
    pub hdr: bool,
    pub audio_codec: Option<String>,
    pub sample_rate: Option<i64>,
    pub channels: Option<i64>,
}

/// 探测结果(供流管道决策 + 文件信息框)。
pub fn probe(path: &str) -> Result<VideoMeta, String> {
    let out = Command::new(ffprobe_path()?)
        .args([
            "-v", "quiet",
            "-print_format", "json",
            "-show_format",
            "-show_streams",
            path,
        ])
        .output()
        .map_err(|e| format!("ffprobe 执行失败: {e}"))?;
    let v: serde_json::Value =
        serde_json::from_slice(&out.stdout).map_err(|e| format!("ffprobe 输出解析失败: {e}"))?;

    let mut meta = VideoMeta::default();
    if let Some(fmt) = v.get("format") {
        meta.format_name = fmt.get("format_name").and_then(|x| x.as_str()).map(|s| s.to_string());
        meta.duration = fmt.get("duration").and_then(|x| x.as_str()).and_then(|s| s.parse().ok());
        meta.bit_rate = fmt.get("bit_rate").and_then(|x| x.as_str()).and_then(|s| s.parse().ok());
    }
    if let Some(streams) = v.get("streams").and_then(|s| s.as_array()) {
        for st in streams {
            let codec_type = st.get("codec_type").and_then(|x| x.as_str()).unwrap_or("");
            match codec_type {
                "video" if meta.video_codec.is_none() => {
                    meta.video_codec = st.get("codec_name").and_then(|x| x.as_str()).map(|s| s.to_string());
                    meta.width = st.get("width").and_then(|x| x.as_i64());
                    meta.height = st.get("height").and_then(|x| x.as_i64());
                    meta.frame_rate = st
                        .get("r_frame_rate")
                        .and_then(|x| x.as_str())
                        .and_then(parse_ratio);
                    // HDR 粗判:bt2020 原色 + PQ(smpte2084)/HLG(arib-std-b67) 传递函数
                    let prim = st.get("color_primaries").and_then(|x| x.as_str()).unwrap_or("");
                    let trc = st.get("color_transfer").and_then(|x| x.as_str()).unwrap_or("");
                    meta.hdr = prim.contains("bt2020")
                        || trc.contains("smpte2084")
                        || trc.contains("arib-std-b67");
                }
                "audio" if meta.audio_codec.is_none() => {
                    meta.audio_codec = st.get("codec_name").and_then(|x| x.as_str()).map(|s| s.to_string());
                    meta.sample_rate = st
                        .get("sample_rate")
                        .and_then(|x| x.as_str())
                        .and_then(|s| s.parse().ok());
                    meta.channels = st.get("channels").and_then(|x| x.as_i64());
                }
                _ => {}
            }
        }
    }
    Ok(meta)
}

fn parse_ratio(s: &str) -> Option<f64> {
    let mut it = s.split('/');
    let n: f64 = it.next()?.parse().ok()?;
    let d: f64 = it.next()?.parse().ok()?;
    if d == 0.0 {
        None
    } else {
        Some(n / d)
    }
}

#[tauri::command]
pub fn ffprobe_meta(path: String) -> Result<VideoMeta, String> {
    probe(&path)
}

// ---------- 流管道决策 ----------

/// WebView2 直接可播的编码组合 → remux(-c copy,CPU≈0);否则转码 H.264+AAC。
fn is_remuxable(meta: &VideoMeta) -> bool {
    let v = meta.video_codec.as_deref().unwrap_or("");
    let v_ok = matches!(v, "h264" | "vp8" | "vp9" | "av01");
    let a_ok = match meta.audio_codec.as_deref() {
        None => true, // 无音频流也可 remux
        Some(a) => matches!(a, "aac" | "mp3" | "opus" | "vorbis"),
    };
    v_ok && a_ok && !meta.hdr
}

/// B 站缓存特例:同目录成对 video.m4s + audio.m4s(method.md §2)。
fn bilibili_pair(path: &Path) -> Option<(PathBuf, PathBuf)> {
    let name = path.file_name()?.to_string_lossy().to_lowercase();
    let dir = path.parent()?;
    if name == "video.m4s" {
        let audio = dir.join("audio.m4s");
        if audio.is_file() {
            return Some((path.to_path_buf(), audio));
        }
    }
    None
}

/// B站下载器 itag 命名对:`<stem>-<视频itag>.m4s` + `<stem>-<音频itag>.m4s`
/// (如 41102606364-1-30080.m4s 视频 / 41102606364-1-30280.m4s 音频)。
/// 当前文件是纯视频(有视频流、无音频流)时,在同目录找同 stem 的纯音频 m4s 作音轨合并。
fn itag_audio_pair(path: &Path, meta: &VideoMeta) -> Option<(PathBuf, PathBuf)> {
    if meta.video_codec.is_none() || meta.audio_codec.is_some() {
        return None; // 只处理"纯视频" m4s;纯音频走原生音频预览,不会到这
    }
    let name = path.file_name()?.to_string_lossy().to_string();
    let stem = name.rsplit_once('-')?.0.to_string(); // 最后一个 '-' 之前的公共前缀
    if stem.is_empty() {
        return None;
    }
    let dir = path.parent()?;
    for entry in std::fs::read_dir(dir).ok()? {
        let f = entry.ok()?.path();
        if f.extension().and_then(|e| e.to_str()) != Some("m4s") {
            continue;
        }
        let fname = f.file_name()?.to_string_lossy().to_string();
        if fname == name || !fname.starts_with(&stem) {
            continue;
        }
        if let Ok(m) = probe(f.to_string_lossy().as_ref()) {
            if m.video_codec.is_none() && m.audio_codec.is_some() {
                return Some((path.to_path_buf(), f));
            }
        }
    }
    None
}

/// 组装 ffmpeg 命令(输出到 stdout 的流式封装)。
fn build_ffmpeg(path: &Path, seek: f64, meta: &VideoMeta) -> Result<(Command, &'static str), String> {
    let ffmpeg = ffmpeg_path()?;
    let remux = is_remuxable(meta);
    // 成对音轨:精确 video.m4s/audio.m4s,或 itag 命名的纯视频+纯音频对
    let pair = bilibili_pair(path).or_else(|| itag_audio_pair(path, meta));

    let mut cmd = Command::new(ffmpeg);
    cmd.arg("-hide_banner").arg("-loglevel").arg("error");
    if seek > 0.0 {
        cmd.arg("-ss").arg(format!("{seek:.3}"));
    }

    if let Some((video, audio)) = &pair {
        // 双输入合并:0=video.m4s 1=audio.m4s
        cmd.arg("-i").arg(video).arg("-i").arg(audio);
        cmd.arg("-map").arg("0:v:0?").arg("-map").arg("1:a:0?");
    } else {
        cmd.arg("-i").arg(path);
        // 全部可选:B站缓存拆成 video.m4s/audio.m4s,单独打开任一个都不应硬失败
        cmd.arg("-map").arg("0:v:0?").arg("-map").arg("0:a:0?");
    }

    if remux {
        // 级别 2:remux 只换封装不解码
        cmd.arg("-c").arg("copy");
    } else {
        // 级别 3:实时转码 H.264+AAC(WebView 三内核 100% 交集,§4.1)
        cmd.args([
            "-c:v", "libx264",
            "-preset", "veryfast",
            "-tune", "zerolatency",
            "-crf", "23",
            "-pix_fmt", "yuv420p",
            "-c:a", "aac",
            "-b:a", "160k",
            "-ac", "2",
        ]);
    }
    // 流式 fragmented MP4(可边产边播、可从 -ss 处起播)
    cmd.args([
        "-movflags", "frag_keyframe+empty_moov+default_base_moof",
        "-f", "mp4",
        "pipe:1",
    ]);
    Ok((cmd, "video/mp4"))
}

// ---------- loopback 流式 HTTP 服务 ----------

/// 把 ffmpeg 子进程 stdout 包成 Read;Drop 时杀进程(客户端断开/读尽即回收)。
struct ChildPipe {
    child: Child,
    stdout: ChildStdout,
}
impl Read for ChildPipe {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        self.stdout.read(buf)
    }
}
impl Drop for ChildPipe {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).unwrap_or("");
            if let Ok(v) = u8::from_str_radix(hex, 16) {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).to_string()
}

/// 解析 /stream?path=...&t=... 查询。
fn parse_query(url: &str) -> (Option<String>, f64) {
    let q = url.split('?').nth(1).unwrap_or("");
    let mut path = None;
    let mut t = 0.0;
    for kv in q.split('&') {
        let mut it = kv.splitn(2, '=');
        let k = it.next().unwrap_or("");
        let v = it.next().unwrap_or("");
        match k {
            "path" => path = Some(percent_decode(v)),
            "t" => t = v.parse().unwrap_or(0.0),
            _ => {}
        }
    }
    (path, t)
}

fn handle_request(request: tiny_http::Request) {
    let url = request.url().to_string();
    if !url.starts_with("/stream") {
        let resp = tiny_http::Response::from_string("observer stream server")
            .with_status_code(tiny_http::StatusCode(200));
        let _ = request.respond(resp);
        return;
    }
    let (path, seek) = parse_query(&url);
    let Some(path) = path else {
        let _ = request.respond(
            tiny_http::Response::from_string("missing path").with_status_code(tiny_http::StatusCode(400)),
        );
        return;
    };

    let result = (|| -> Result<(ChildPipe, &'static str), String> {
        let p = Path::new(&path);
        let meta = probe(&path)?;
        if meta.video_codec.is_none() && meta.audio_codec.is_none() {
            return Err("未检测到可播放的音/视频流(可能不是媒体文件或已损坏)".to_string());
        }
        let (mut cmd, content_type) = build_ffmpeg(p, seek, &meta)?;
        let mut child = cmd
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .stdin(Stdio::null())
            .spawn()
            .map_err(|e| format!("ffmpeg 启动失败: {e}"))?;
        let stdout = child.stdout.take().ok_or("无法获取 ffmpeg stdout")?;
        // 持续抽干 stderr 防止 ffmpeg 因管道写满而阻塞;进程结束后把错误打到 dev 控制台便于诊断
        if let Some(mut es) = child.stderr.take() {
            std::thread::spawn(move || {
                let mut buf = String::new();
                let _ = es.read_to_string(&mut buf);
                if !buf.trim().is_empty() {
                    eprintln!("[observer ffmpeg] {}", buf.trim());
                }
            });
        }
        Ok((ChildPipe { child, stdout }, content_type))
    })();

    match result {
        Ok((pipe, content_type)) => {
            let headers = vec![
                tiny_http::Header::from_bytes(&b"Content-Type"[..], content_type.as_bytes()).unwrap(),
                tiny_http::Header::from_bytes(&b"Access-Control-Allow-Origin"[..], &b"*"[..]).unwrap(),
                tiny_http::Header::from_bytes(&b"Cache-Control"[..], &b"no-store"[..]).unwrap(),
            ];
            // data_length=None → chunked 流式输出
            let resp = tiny_http::Response::new(tiny_http::StatusCode(200), headers, pipe, None, None);
            let _ = request.respond(resp);
        }
        Err(e) => {
            let resp = tiny_http::Response::from_string(format!("stream error: {e}"))
                .with_status_code(tiny_http::StatusCode(500));
            let _ = request.respond(resp);
        }
    }
}

/// 启动 127.0.0.1 loopback 流服务,返回绑定端口。
pub fn start_stream_server() -> Result<u16, String> {
    let server = tiny_http::Server::http("127.0.0.1:0").map_err(|e| format!("流服务启动失败: {e}"))?;
    let port = match server.server_addr() {
        tiny_http::ListenAddr::IP(addr) => addr.port(),
        #[allow(unreachable_patterns)]
        _ => return Err("流服务地址异常".to_string()),
    };
    std::thread::spawn(move || {
        for request in server.incoming_requests() {
            std::thread::spawn(move || handle_request(request));
        }
    });
    Ok(port)
}

/// 前端取流服务基址(http://127.0.0.1:PORT)。State 存端口号。
#[tauri::command]
pub fn stream_base_url(state: tauri::State<StreamState>) -> String {
    format!("http://127.0.0.1:{}", state.port)
}

pub struct StreamState {
    pub port: u16,
}

// ---------- 缩略图(海报帧) ----------

/// 生成视频海报帧到磁盘缓存(key = path+mtime+size),返回 PNG 路径(前端经 asset:// 加载)。
#[tauri::command]
pub fn video_thumbnail(
    app: tauri::AppHandle,
    path: String,
    at: Option<f64>,
) -> Result<String, String> {
    use tauri::Manager;
    let meta_fs = std::fs::metadata(&path).map_err(|e| format!("无法读取文件: {e}"))?;
    let key = format!("{:x}", {
        // 简易稳定 key:路径 + 长度 + mtime
        use std::hash::{Hash, Hasher};
        let mut h = std::collections::hash_map::DefaultHasher::new();
        path.hash(&mut h);
        meta_fs.len().hash(&mut h);
        h.finish()
    });
    let dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?
        .join("thumbs");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let out = dir.join(format!("thumb_{key}.png"));
    if out.is_file() {
        return Ok(out.to_string_lossy().to_string());
    }

    let t = at.unwrap_or(1.0);
    let status = Command::new(ffmpeg_path()?)
        .args([
            "-hide_banner",
            "-loglevel",
            "error",
            "-ss",
            &format!("{t:.3}"),
            "-i",
            &path,
            "-frames:v",
            "1",
            "-vf",
            "scale=480:-1",
            "-y",
        ])
        .arg(&out)
        .status()
        .map_err(|e| format!("ffmpeg 截图失败: {e}"))?;
    if status.success() && out.is_file() {
        Ok(out.to_string_lossy().to_string())
    } else {
        Err("截图生成失败".to_string())
    }
}

// ---------- 测试(端到端冒烟:真起服务、真 remux、校验 fMP4 流) ----------

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use std::net::TcpStream;
    use std::time::{Duration, Instant};

    /// 生成一个 3s 的 H.264+AAC mkv(走 remux 路径),放临时目录。
    fn make_test_mkv() -> PathBuf {
        let out = std::env::temp_dir().join("observer_stream_test.mkv");
        let status = Command::new(ffmpeg_path().expect("ffmpeg"))
            .args([
                "-hide_banner", "-loglevel", "error", "-y",
                "-f", "lavfi", "-i", "testsrc=duration=3:size=320x240:rate=25",
                "-f", "lavfi", "-i", "sine=frequency=440:duration=3",
                "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest",
                "-f", "matroska",
            ])
            .arg(&out)
            .status()
            .expect("spawn ffmpeg");
        assert!(status.success(), "生成测试 mkv 失败");
        out
    }

    /// itag 命名对:同 stem 的纯视频 m4s 应能找到纯音频 m4s 作音轨。
    #[test]
    fn itag_pair_finds_audio_sibling() {
        let dir = std::env::temp_dir().join(format!("observer_itag_{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let video = dir.join("c123-1-30080.m4s");
        let audio = dir.join("c123-1-30280.m4s");
        let gen = |args: &[&str], out: &Path| {
            let st = Command::new(ffmpeg_path().expect("ffmpeg"))
                .args(["-hide_banner", "-loglevel", "error", "-y"])
                .args(args)
                .arg(out)
                .status()
                .expect("spawn ffmpeg");
            assert!(st.success());
        };
        gen(
            &["-f", "lavfi", "-i", "testsrc=duration=2:size=160x120:rate=25", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "frag_keyframe", "-f", "mp4"],
            &video,
        );
        gen(
            &["-f", "lavfi", "-i", "sine=frequency=440:duration=2", "-c:a", "aac", "-movflags", "frag_keyframe", "-f", "mp4"],
            &audio,
        );

        let vmeta = probe(video.to_string_lossy().as_ref()).expect("probe video");
        assert!(vmeta.video_codec.is_some() && vmeta.audio_codec.is_none(), "视频 m4s 应为纯视频");
        let pair = itag_audio_pair(&video, &vmeta).expect("应找到音频姊妹");
        assert_eq!(pair.0, video);
        assert_eq!(pair.1, audio, "应匹配同 stem 的纯音频 m4s");

        // 纯音频文件本身不应触发配对(它走原生音频预览)
        let ameta = probe(audio.to_string_lossy().as_ref()).expect("probe audio");
        assert!(itag_audio_pair(&audio, &ameta).is_none());

        std::fs::remove_dir_all(&dir).ok();
    }

    /// 与前端 encodeURIComponent 等价的最小百分号编码(非 unreserved 全转 %XX)。
    fn encode(p: &Path) -> String {
        p.to_string_lossy()
            .bytes()
            .map(|b| match b {
                b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                    (b as char).to_string()
                }
                _ => format!("%{b:02X}"),
            })
            .collect()
    }

    #[test]
    fn probe_parses_streams() {
        let input = make_test_mkv();
        let meta = probe(&input.to_string_lossy()).expect("probe");
        assert_eq!(meta.video_codec.as_deref(), Some("h264"));
        assert_eq!(meta.width, Some(320));
        assert_eq!(meta.height, Some(240));
        assert!(is_remuxable(&meta), "h264+aac 应判为可 remux");
    }

    #[test]
    fn stream_server_serves_fmp4() {
        let input = make_test_mkv();
        let port = start_stream_server().expect("start server");
        let mut stream = TcpStream::connect(("127.0.0.1", port)).expect("connect");
        stream.set_read_timeout(Some(Duration::from_secs(10))).unwrap();
        let req = format!(
            "GET /stream?path={}&t=0 HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n",
            encode(&input)
        );
        stream.write_all(req.as_bytes()).unwrap();

        // 读流直到看到 fMP4 的 ftyp box(或拿到足够字节/超时)
        let mut buf = Vec::new();
        let mut chunk = [0u8; 8192];
        let deadline = Instant::now() + Duration::from_secs(20);
        while buf.len() < 256 * 1024 && Instant::now() < deadline {
            match stream.read(&mut chunk) {
                Ok(0) => break,
                Ok(n) => {
                    buf.extend_from_slice(&chunk[..n]);
                    if buf.windows(4).any(|w| w == b"ftyp") {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
        assert!(
            buf.windows(4).any(|w| w == b"ftyp"),
            "流响应应包含 fMP4 的 ftyp box,实际收到 {} 字节",
            buf.len()
        );
        assert!(buf.len() > 1024, "流应有实际媒体数据,仅 {} 字节", buf.len());
    }
}
