//! End-to-end golden flow for the CIR-30 workspace lifecycle.
//!
//! Each test wires together a temp source repo, a temp Store, and a temp
//! workspace root. Exercises the API surface the rest of the agent runtime
//! is expected to use: `acquire → record_turn → release → cleanup → recover`
//! plus `cold_resume` on a fresh manager (simulating process crash + restart).

use app_lib::workspace::{
    git_ops::init_repo_with_initial_commit, StoreAction, TurnBoundary, WorkspaceManager,
    WorkspaceState, WorkspaceStore,
};
use std::time::Duration;
use tempfile::TempDir;

struct Harness {
    _src: TempDir,
    _ws_root: TempDir,
    _store_dir: TempDir,
    mgr: WorkspaceManager,
    repo_url: String,
}

async fn build() -> Harness {
    let src = TempDir::new().unwrap();
    init_repo_with_initial_commit(src.path()).await.unwrap();
    let store_dir = TempDir::new().unwrap();
    let ws_root = TempDir::new().unwrap();
    let store = WorkspaceStore::open(store_dir.path()).await.unwrap();
    let mgr = WorkspaceManager::new(ws_root.path(), store, Duration::from_secs(60))
        .await
        .unwrap();
    let repo_url = format!("file://{}", src.path().display());
    Harness {
        _src: src,
        _ws_root: ws_root,
        _store_dir: store_dir,
        mgr,
        repo_url,
    }
}

#[tokio::test]
async fn golden_flow_acquire_turns_cleanup_cold_resume() {
    let h = build().await;

    // 1. Acquire fresh.
    let ws = h.mgr.acquire("alice", &h.repo_url).await.unwrap();
    assert_eq!(ws.state().await, WorkspaceState::Attached);

    // 2. Two completed turns + scratch file changes.
    ws.record_turn(TurnBoundary::now(1)).await;
    tokio::fs::write(ws.path.join("scratch.txt"), b"first turn output\n")
        .await
        .unwrap();
    ws.record_turn(TurnBoundary::now(2)).await;
    tokio::fs::write(ws.path.join("scratch.txt"), b"second turn output\n")
        .await
        .unwrap();

    // 3. Release + idle TTL cleanup.
    ws.release().await.unwrap();
    h.mgr.cleanup(&ws).await.unwrap();
    assert!(!ws.path.exists());

    // 4. Cold resume from metadata only.
    let meta = h.mgr.store().read_metadata(&ws.id).await.unwrap().unwrap();
    let resumed = h.mgr.cold_resume(&meta).await.unwrap();

    let restored = tokio::fs::read(resumed.path.join("scratch.txt"))
        .await
        .unwrap();
    assert_eq!(restored, b"second turn output\n");
    assert_eq!(
        resumed.metadata_snapshot().await.head_commit,
        meta.head_commit
    );
}

#[tokio::test]
async fn concurrent_acquire_isolates_clones_for_same_user_repo() {
    let h = build().await;
    let a = h.mgr.acquire("alice", &h.repo_url).await.unwrap();
    let b = h.mgr.acquire("alice", &h.repo_url).await.unwrap();
    assert_ne!(a.id, b.id);
    assert_ne!(a.path, b.path);

    // Edits in `a` must not be visible in `b`.
    tokio::fs::write(a.path.join("only-a.txt"), b"a\n").await.unwrap();
    assert!(!b.path.join("only-a.txt").exists());

    // Try to attach to `a` again from a third caller — must be rejected.
    let again = a.attach().await;
    assert!(matches!(
        again,
        Err(app_lib::workspace::Error::AlreadyAttached(_))
    ));
}

#[tokio::test]
async fn crash_recovery_with_disk_intact_keeps_workspace() {
    let h = build().await;
    let ws = h.mgr.acquire("bob", &h.repo_url).await.unwrap();
    let id = ws.id.clone();
    let path = ws.path.clone();
    ws.record_turn(TurnBoundary::now(1)).await;
    h.mgr
        .store()
        .write_metadata(&ws.metadata_snapshot().await)
        .await
        .unwrap();

    // Simulate process crash: forget the in-memory workspace, but disk + Store survive.
    drop(ws);
    h.mgr.unregister(&id).await;

    // Restart path: recover by id.
    let recovered = h.mgr.recover(&id).await.unwrap();
    assert_eq!(recovered.path, path);
    assert_eq!(recovered.state().await, WorkspaceState::Idle);
    assert_eq!(
        recovered.metadata_snapshot().await.last_turn.unwrap().turn_index,
        1
    );
}

#[tokio::test]
async fn crash_recovery_replays_from_action_log_when_disk_lost() {
    let h = build().await;
    let ws = h.mgr.acquire("bob", &h.repo_url).await.unwrap();
    let id = ws.id.clone();
    tokio::fs::write(ws.path.join("scratch.txt"), b"WIP\n")
        .await
        .unwrap();
    ws.record_turn(TurnBoundary::now(1)).await;
    ws.release().await.unwrap();
    h.mgr.cleanup(&ws).await.unwrap();

    // Disk is gone, only Store knows about the workspace.
    let recovered = h.mgr.recover(&id).await.unwrap();
    assert!(recovered.path.exists());
    let restored = tokio::fs::read(recovered.path.join("scratch.txt"))
        .await
        .unwrap();
    assert_eq!(restored, b"WIP\n");

    // Action log must contain Acquire → Stash → Cleanup → ColdResume.
    let actions = h.mgr.store().read_actions(&id).await.unwrap();
    let kinds: Vec<&'static str> = actions
        .iter()
        .map(|a| match a {
            StoreAction::Acquire { .. } => "Acquire",
            StoreAction::TurnComplete { .. } => "TurnComplete",
            StoreAction::Stash { .. } => "Stash",
            StoreAction::Cleanup => "Cleanup",
            StoreAction::ColdResume { .. } => "ColdResume",
        })
        .collect();
    assert!(kinds.contains(&"Acquire"));
    assert!(kinds.contains(&"Stash"));
    assert!(kinds.contains(&"Cleanup"));
    assert!(kinds.contains(&"ColdResume"));
}

#[tokio::test]
async fn abort_cancels_in_flight_token_without_corrupting_metadata() {
    let h = build().await;
    let ws = h.mgr.acquire("carol", &h.repo_url).await.unwrap();
    ws.record_turn(TurnBoundary::now(7)).await;

    // Spawn a "tool call" that respects the cancel token.
    let token = ws.cancel_token();
    let task = tokio::spawn(async move {
        tokio::select! {
            _ = token.cancelled() => "cancelled",
            _ = tokio::time::sleep(Duration::from_secs(5)) => "completed",
        }
    });

    ws.abort().await.unwrap();
    let outcome = task.await.unwrap();
    assert_eq!(outcome, "cancelled");
    assert_eq!(ws.state().await, WorkspaceState::Aborting);

    // Settle: release returns to Idle, last_turn unchanged.
    ws.release().await.unwrap();
    assert_eq!(ws.state().await, WorkspaceState::Idle);
    assert_eq!(
        ws.metadata_snapshot().await.last_turn.unwrap().turn_index,
        7
    );
}
