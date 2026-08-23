mod commands;
mod formats;

// TODO(M2): SQLite 持久化层(design.md §9)— app_state / preview_history /
// media_position / doc_position / threed_camera。预留 src/db.rs(rusqlite),本轮不实现。
// TODO(M1): FFmpeg sidecar + stream:// 协议(design.md §6/§7)— 视频四级预览管道。

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .invoke_handler(tauri::generate_handler![
            commands::list_dir,
            commands::read_text_file,
            commands::file_stat,
            commands::reveal_in_explorer,
            commands::detect_format,
            commands::allow_asset_path,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
