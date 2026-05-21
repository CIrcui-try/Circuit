//! Phase 7 (CIR-35): end-to-end smoke for the Tauri command wrappers.
//!
//! The actual `#[tauri::command]` functions need a Tauri `State` to be invoked
//! directly, which requires a full app harness. We instead exercise the same
//! sequence those commands run internally — `WorkspaceManager` calls keyed by
//! id through `WorkspaceManagerState` — so a regression in the wiring (wrong
//! state Arc, dropped registry, missing await) shows up here without the
//! Tauri dependency. Combined with the unit tests inside `workspace_commands.rs`
//! this gives the same coverage the Linear acceptance criteria asks for.

use app_lib::workspace::{
    git_ops::init_repo_with_initial_commit, WarmPool, WorkspaceManager, WorkspaceState,
    WorkspaceStore,
};
use std::sync::Arc;
use std::time::Duration;
use tempfile::TempDir;

struct Harness {
    _src: TempDir,
    _ws_root: TempDir,
    _store_dir: TempDir,
    mgr: Arc<WorkspaceManager>,
    pool: Arc<WarmPool>,
    repo_url: String,
}

async fn build() -> Harness {
    let src = TempDir::new().unwrap();
    init_repo_with_initial_commit(src.path()).await.unwrap();
    let store_dir = TempDir::new().unwrap();
    let ws_root = TempDir::new().unwrap();
    let store = WorkspaceStore::open(store_dir.path()).await.unwrap();
    let pool = Arc::new(WarmPool::new(2, 4));
    let mgr = Arc::new(
        WorkspaceManager::new(ws_root.path(), store, Duration::from_secs(60))
            .await
            .unwrap()
            .with_pool(Arc::clone(&pool)),
    );
    let repo_url = format!("file://{}", src.path().display());
    Harness {
        _src: src,
        _ws_root: ws_root,
        _store_dir: store_dir,
        mgr,
        pool,
        repo_url,
    }
}

/// Mirrors what RealWorkflowRunner does on a successful run:
/// acquire → begin_turn → commit_turn → release_to_pool. Verifies disk + pool
/// state after each step so a wiring regression in any one command surfaces.
#[tokio::test]
async fn full_run_cycle_acquire_begin_commit_release() {
    let h = build().await;

    // acquire_workspace
    let ws = h.mgr.acquire("default", &h.repo_url).await.unwrap();
    assert_eq!(ws.state().await, WorkspaceState::Attached);
    assert!(ws.path.exists(), "workspace path must exist after acquire");
    assert_eq!(h.pool.stats().await.misses, 1);

    // begin_turn (turn_index = 1, the runner's first turn for this run)
    h.mgr.begin_turn(&ws, 1).await.unwrap();
    assert!(ws.active_turn().await.is_some());

    // commit_turn (no working-tree changes to commit, but the turn marker
    // must still settle so release_to_pool is allowed)
    h.mgr.commit_turn(&ws).await.unwrap();
    assert!(ws.active_turn().await.is_none());
    assert_eq!(
        ws.metadata_snapshot().await.last_turn.map(|t| t.turn_index),
        Some(1)
    );

    // release_to_pool
    let ws_id = ws.id.clone();
    h.mgr.release_to_pool(&ws).await.unwrap();
    assert_eq!(h.pool.stats().await.size, 1, "released slot is in the pool");

    // Subsequent acquire is a pool hit and reuses the same workspace id.
    let ws2 = h.mgr.acquire("default", &h.repo_url).await.unwrap();
    assert_eq!(ws2.id, ws_id);
    assert_eq!(h.pool.stats().await.hits, 1);
}

/// Mid-turn release must surface as `Error::TurnInFlight` — the same string
/// the frontend will see through `cleanup_workspace` / `release_to_pool`.
/// Confirms the Phase 5 invariant ("only settled HEADs in the pool") is still
/// enforced after the wrapper layer.
#[tokio::test]
async fn release_during_turn_returns_turn_in_flight() {
    let h = build().await;

    let ws = h.mgr.acquire("default", &h.repo_url).await.unwrap();
    h.mgr.begin_turn(&ws, 1).await.unwrap();

    let err = h
        .mgr
        .release_to_pool(&ws)
        .await
        .expect_err("must reject mid-turn release");
    assert!(
        matches!(err, app_lib::workspace::Error::TurnInFlight(_)),
        "expected TurnInFlight, got {err:?}"
    );
    assert_eq!(
        h.pool.stats().await.size,
        0,
        "rejected workspace must not enter the pool"
    );
}

/// `prewarm` is the dedicated command that lets the frontend pre-fill the pool
/// before a run; later acquires must hit and skip the cold clone path.
#[tokio::test]
async fn prewarm_then_acquire_is_a_pool_hit() {
    let h = build().await;

    h.mgr.prewarm("default", &h.repo_url, 1).await.unwrap();
    assert_eq!(h.pool.stats().await.size, 1);

    let _ws = h.mgr.acquire("default", &h.repo_url).await.unwrap();
    let s = h.pool.stats().await;
    assert!(s.hits >= 1, "acquire after prewarm should hit, got {s:?}");
}
