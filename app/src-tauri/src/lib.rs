mod runtime_bridge;
mod skill_scan;
mod workflow_store;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .manage(runtime_bridge::RuntimeBridgeState::default())
        .invoke_handler(tauri::generate_handler![
            skill_scan::scan_skills,
            workflow_store::list_workflows,
            workflow_store::load_workflow,
            workflow_store::save_workflow,
            runtime_bridge::runtime_read_file,
            runtime_bridge::runtime_spawn,
            runtime_bridge::runtime_cancel,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
