mod run_log_store;
mod mcp_config;
mod repository_environment;
mod runtime_bridge;
mod skill_scan;
mod tutorial;
mod workflow_store;
pub mod workspace;
mod workspace_commands;

use std::sync::Arc;
use std::time::Duration;

use tauri::Manager;

use workspace::{WarmPool, WorkspaceManager, WorkspaceStore};
use workspace_commands::WorkspaceManagerState;

/// Phase 5 (CIR-33) §3.2 / Phase 6 (CIR-34): warm-pool sizing for the v1
/// single-user desktop build. 2 slots per (user, repo) covers the common
/// "edit while a run is in flight" case; max_total = 16 caps disk so a
/// many-repo session doesn't unbounded-grow the workspace root.
const WARM_POOL_MAX_PER_KEY: usize = 2;
const WARM_POOL_MAX_TOTAL: usize = 16;

/// Idle workspaces older than this get TTL-cleaned. Aligns with the
/// "15 min default" copy in `workspace/README.md`.
const IDLE_TTL: Duration = Duration::from_secs(15 * 60);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .manage(runtime_bridge::RuntimeBridgeState::default())
        .setup(|app| {
            let data_dir = app
                .path()
                .app_local_data_dir()
                .expect("app_local_data_dir must resolve");
            let workspace_root = data_dir.join("workspaces");
            let store_root = data_dir.join("store");

            let manager = tauri::async_runtime::block_on(async {
                let store = WorkspaceStore::open(&store_root).await?;
                let pool = Arc::new(WarmPool::new(WARM_POOL_MAX_PER_KEY, WARM_POOL_MAX_TOTAL));
                let manager = WorkspaceManager::new(&workspace_root, store, IDLE_TTL)
                    .await?
                    .with_pool(pool);
                Ok::<_, workspace::Error>(manager)
            })?;

            app.manage(WorkspaceManagerState::new(manager));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            skill_scan::scan_skills,
            skill_scan::create_repository_skill,
            skill_scan::delete_repository_skill,
            skill_scan::change_repository_skill_provider,
            skill_scan::scan_default_skills,
            skill_scan::scan_system_skills,
            skill_scan::runtime_read_system_skill,
            skill_scan::runtime_read_default_skill,
            workflow_store::list_workflows,
            workflow_store::load_workflow,
            workflow_store::save_workflow,
            workflow_store::delete_workflow,
            workflow_store::export_workflow_bundle,
            workflow_store::preview_workflow_bundle_import,
            workflow_store::import_workflow_bundle,
            mcp_config::read_mcp_config_status,
            repository_environment::check_repository_environment,
            runtime_bridge::runtime_read_file,
            runtime_bridge::runtime_resolve_cli,
            runtime_bridge::runtime_spawn,
            runtime_bridge::runtime_cancel,
            runtime_bridge::runtime_send_input,
            runtime_bridge::runtime_close_input,
            run_log_store::save_run_log,
            run_log_store::list_run_logs,
            run_log_store::load_run_log,
            tutorial::create_tutorial_repository,
            tutorial::path_exists,
            workspace_commands::acquire_workspace,
            workspace_commands::release_to_pool,
            workspace_commands::cleanup_workspace,
            workspace_commands::begin_turn,
            workspace_commands::commit_turn,
            workspace_commands::prewarm,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
