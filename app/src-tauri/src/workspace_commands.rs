//! Phase 7 (CIR-35): Tauri command wrappers for the workspace module.
//!
//! Production bootstrap calls `WorkspaceManager` through these commands so the
//! frontend (`RealWorkflowRunner`) can drive the lifecycle (`acquire`,
//! `begin_turn`, `commit_turn`, `release_to_pool`, etc.) without touching Rust
//! types directly. Each command is a thin adapter: parse → look up the
//! workspace by id when needed → call the manager → map `Error` to a string
//! the frontend can show in LogPanel / RunPreviewModal.

use std::path::PathBuf;
use std::sync::Arc;

use serde::Serialize;
use tauri::State;

use crate::workspace::{Error, Workspace, WorkspaceId, WorkspaceManager};

#[derive(Clone)]
pub struct WorkspaceManagerState {
    inner: Arc<WorkspaceManager>,
}

impl WorkspaceManagerState {
    pub fn new(manager: WorkspaceManager) -> Self {
        Self {
            inner: Arc::new(manager),
        }
    }

    pub fn manager(&self) -> &WorkspaceManager {
        &self.inner
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceDto {
    pub id: String,
    pub path: PathBuf,
    pub branch: Option<String>,
    pub head_commit: String,
    pub user_id: String,
    pub repo_url: String,
}

impl WorkspaceDto {
    async fn from_workspace(ws: &Workspace) -> Self {
        let meta = ws.metadata_snapshot().await;
        Self {
            id: ws.id.0.clone(),
            path: ws.path.clone(),
            branch: meta.branch,
            head_commit: meta.head_commit,
            user_id: meta.user_id,
            repo_url: meta.repo_url,
        }
    }
}

fn map_err(e: Error) -> String {
    e.to_string()
}

async fn lookup_or_err(
    mgr: &WorkspaceManager,
    workspace_id: &str,
) -> Result<Arc<Workspace>, String> {
    let id = WorkspaceId(workspace_id.to_owned());
    mgr.lookup(&id)
        .await
        .ok_or_else(|| format!("workspace not registered: {workspace_id}"))
}

#[tauri::command]
pub async fn acquire_workspace(
    state: State<'_, WorkspaceManagerState>,
    user_id: String,
    repo_url: String,
) -> Result<WorkspaceDto, String> {
    let mgr = state.manager().clone();
    let ws = mgr.acquire(&user_id, &repo_url).await.map_err(map_err)?;
    Ok(WorkspaceDto::from_workspace(&ws).await)
}

#[tauri::command]
pub async fn release_to_pool(
    state: State<'_, WorkspaceManagerState>,
    workspace_id: String,
) -> Result<(), String> {
    let mgr = state.manager().clone();
    let ws = lookup_or_err(&mgr, &workspace_id).await?;
    mgr.release_to_pool(&ws).await.map_err(map_err)
}

#[tauri::command]
pub async fn cleanup_workspace(
    state: State<'_, WorkspaceManagerState>,
    workspace_id: String,
) -> Result<(), String> {
    let mgr = state.manager().clone();
    let ws = lookup_or_err(&mgr, &workspace_id).await?;
    mgr.cleanup(&ws).await.map_err(map_err)
}

#[tauri::command]
pub async fn begin_turn(
    state: State<'_, WorkspaceManagerState>,
    workspace_id: String,
    turn_index: u64,
) -> Result<(), String> {
    let mgr = state.manager().clone();
    let ws = lookup_or_err(&mgr, &workspace_id).await?;
    mgr.begin_turn(&ws, turn_index).await.map_err(map_err)
}

#[tauri::command]
pub async fn commit_turn(
    state: State<'_, WorkspaceManagerState>,
    workspace_id: String,
) -> Result<(), String> {
    let mgr = state.manager().clone();
    let ws = lookup_or_err(&mgr, &workspace_id).await?;
    mgr.commit_turn(&ws).await.map_err(map_err)
}

#[tauri::command]
pub async fn prewarm(
    state: State<'_, WorkspaceManagerState>,
    user_id: String,
    repo_url: String,
    count: usize,
) -> Result<(), String> {
    let mgr = state.manager().clone();
    mgr.prewarm(&user_id, &repo_url, count).await.map_err(map_err)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workspace::git_ops::init_repo_with_initial_commit;
    use crate::workspace::{WarmPool, WorkspaceStore};
    use std::time::Duration;
    use tempfile::TempDir;

    /// `WorkspaceManagerState::new` wraps the manager in `Arc`, so cloning the
    /// state must yield a handle that points at the same inner manager. Without
    /// this, every Tauri command would see an isolated registry and `lookup`
    /// would always fail across calls.
    #[tokio::test]
    async fn manager_state_clone_shares_registry() {
        let store_dir = TempDir::new().unwrap();
        let ws_root = TempDir::new().unwrap();
        let store = WorkspaceStore::open(store_dir.path()).await.unwrap();
        let mgr = WorkspaceManager::new(ws_root.path(), store, Duration::from_secs(60))
            .await
            .unwrap()
            .with_pool(Arc::new(WarmPool::new(1, 1)));

        let state_a = WorkspaceManagerState::new(mgr);
        let state_b = state_a.clone();

        let src = TempDir::new().unwrap();
        init_repo_with_initial_commit(src.path()).await.unwrap();
        let repo_url = format!("file://{}", src.path().display());

        let ws = state_a
            .manager()
            .acquire("alice", &repo_url)
            .await
            .unwrap();

        // Lookup through the cloned state must resolve the same handle.
        let found = state_b.manager().lookup(&ws.id).await.expect("registered");
        assert_eq!(found.id, ws.id);
    }

    /// The helper that powers every id-keyed command must surface a readable
    /// string rather than panicking when the workspace is unknown.
    #[tokio::test]
    async fn lookup_or_err_returns_error_for_unknown_id() {
        let store_dir = TempDir::new().unwrap();
        let ws_root = TempDir::new().unwrap();
        let store = WorkspaceStore::open(store_dir.path()).await.unwrap();
        let mgr = WorkspaceManager::new(ws_root.path(), store, Duration::from_secs(60))
            .await
            .unwrap();

        let err = lookup_or_err(&mgr, "nope").await.unwrap_err();
        assert!(err.contains("nope"), "error must include the id, got: {err}");
    }

    /// End-to-end shape check covering the wrapper layer: acquire → begin_turn
    /// → commit_turn → release_to_pool. Calls the manager directly with the
    /// same arguments the Tauri command bodies pass through, so a regression
    /// in the wiring (wrong arg name, missing await, dropped state) shows up
    /// here without needing a Tauri test harness.
    #[tokio::test]
    async fn full_cycle_via_manager_matches_command_bodies() {
        let store_dir = TempDir::new().unwrap();
        let ws_root = TempDir::new().unwrap();
        let store = WorkspaceStore::open(store_dir.path()).await.unwrap();
        let pool = Arc::new(WarmPool::new(2, 4));
        let mgr = WorkspaceManager::new(ws_root.path(), store, Duration::from_secs(60))
            .await
            .unwrap()
            .with_pool(Arc::clone(&pool));

        let state = WorkspaceManagerState::new(mgr);

        let src = TempDir::new().unwrap();
        init_repo_with_initial_commit(src.path()).await.unwrap();
        let repo_url = format!("file://{}", src.path().display());

        // acquire_workspace body
        let ws = state.manager().acquire("alice", &repo_url).await.unwrap();
        let dto = WorkspaceDto::from_workspace(&ws).await;
        assert_eq!(dto.id, ws.id.0);
        assert_eq!(dto.user_id, "alice");

        // begin_turn body
        state.manager().begin_turn(&ws, 1).await.unwrap();
        // commit_turn body
        state.manager().commit_turn(&ws).await.unwrap();
        // release_to_pool body
        state.manager().release_to_pool(&ws).await.unwrap();

        let stats = pool.stats().await;
        assert_eq!(stats.size, 1, "released slot should sit in the pool");
    }

    /// Mid-turn release must surface as a `TurnInFlight` string the frontend
    /// can show — confirms `Error::Display` produces something useful and that
    /// `map_err` doesn't swallow the variant.
    #[tokio::test]
    async fn release_to_pool_mid_turn_yields_turn_in_flight_string() {
        let store_dir = TempDir::new().unwrap();
        let ws_root = TempDir::new().unwrap();
        let store = WorkspaceStore::open(store_dir.path()).await.unwrap();
        let pool = Arc::new(WarmPool::new(2, 4));
        let mgr = WorkspaceManager::new(ws_root.path(), store, Duration::from_secs(60))
            .await
            .unwrap()
            .with_pool(pool);

        let src = TempDir::new().unwrap();
        init_repo_with_initial_commit(src.path()).await.unwrap();
        let repo_url = format!("file://{}", src.path().display());

        let ws = mgr.acquire("alice", &repo_url).await.unwrap();
        mgr.begin_turn(&ws, 1).await.unwrap();

        let err = mgr.release_to_pool(&ws).await.map_err(map_err).unwrap_err();
        assert!(
            err.contains("turn in flight"),
            "expected TurnInFlight Display, got: {err}"
        );
    }
}
