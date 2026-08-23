mod commands;
mod db;
mod ffmpeg;
mod formats;

use tauri::Manager;

// M1:FFmpeg 经 loopback HTTP 服务流出(design.md §7 兜底方案——自定义协议需整body在内存,无法边转边播)。

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .setup(|app| {
            // SQLite 持久化层(design.md §9):打开/建库并纳入 managed state
            let dir = app
                .path()
                .app_data_dir()
                .map_err(|e| format!("无法定位应用数据目录: {e}"))?;
            let db = db::init(&dir.join("observer.db"))?;
            app.manage(db);

            // M1:启动 loopback 流服务(ffmpeg stdout → HTTP 流式响应)
            let port = ffmpeg::start_stream_server()?;
            app.manage(ffmpeg::StreamState { port });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_dir,
            commands::read_text_file,
            commands::file_stat,
            commands::reveal_in_explorer,
            commands::detect_format,
            commands::allow_asset_path,
            commands::resolve_link,
            db::app_state_get,
            db::app_state_set,
            db::history_open,
            db::history_list,
            db::history_remove,
            db::history_clear,
            db::media_pos_get,
            db::media_pos_set,
            db::doc_pos_get,
            db::doc_pos_set,
            ffmpeg::ffprobe_meta,
            ffmpeg::stream_base_url,
            ffmpeg::video_thumbnail,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
