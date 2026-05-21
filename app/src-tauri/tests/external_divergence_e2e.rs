//! Phase 4 (CIR-32) external divergence e2e.
//!
//! Verifies that **every** way Store ↔ Workspace can drift apart funnels
//! through `WorkspaceManager::reconcile`'s 3-step decision tree:
//!
//!   1. Store head == workspace HEAD → reuse as-is.
//!   2. Disk exists but HEAD diverged → reset_hard back to Store head.
//!   3. Disk gone or `.git` unreadable → cold-resume via re-clone.
//!
//! The three scenarios mirror the acceptance criteria in CIR-32:
//! external git push, workspace disk loss, and direct user git ops.

use app_lib::workspace::{
    git_ops::init_repo_with_initial_commit, ColdResumeReason, ReconcileOutcome,
    ReconcileStrategy, StoreAction, WorkspaceManager, WorkspaceStore,
};
use std::path::Path;
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

async fn run_git(path: &Path, args: &[&str]) -> String {
    let out = tokio::process::Command::new("git")
        .current_dir(path)
        .args(args)
        .output()
        .await
        .unwrap();
    assert!(
        out.status.success(),
        "git {args:?} failed: {}",
        String::from_utf8_lossy(&out.stderr),
    );
    String::from_utf8_lossy(&out.stdout).into_owned()
}

/// Acceptance criterion: external git push moved HEAD past Store's recorded
/// commit. Reconcile must reset_hard to Store's head (Store wins) and report
/// `Replay`. The external commit's tree must not survive.
#[tokio::test]
async fn external_push_moves_head_triggers_replay() {
    let h = build().await;
    let ws = h.mgr.acquire("alice", &h.repo_url).await.unwrap();
    let id = ws.id.clone();
    let path = ws.path.clone();
    let store_head = ws.metadata_snapshot().await.head_commit.clone();
    h.mgr
        .store()
        .write_metadata(&ws.metadata_snapshot().await)
        .await
        .unwrap();
    ws.release().await.unwrap();
    h.mgr.unregister(&id).await;

    // Simulate "external push pulled in" by committing directly on disk.
    tokio::fs::write(path.join("upstream.txt"), b"upstream\n")
        .await
        .unwrap();
    run_git(&path, &["add", "-A"]).await;
    run_git(
        &path,
        &[
            "-c",
            "user.email=upstream@cir32.local",
            "-c",
            "user.name=upstream",
            "-c",
            "commit.gpgsign=false",
            "commit",
            "-m",
            "external push",
        ],
    )
    .await;
    let diverged_head = run_git(&path, &["rev-parse", "HEAD"]).await.trim().to_owned();
    assert_ne!(diverged_head, store_head);

    let (recovered, outcome) = h.mgr.reconcile(&id).await.unwrap();
    match &outcome {
        ReconcileOutcome::Replay { from, to } => {
            assert_eq!(from, &diverged_head);
            assert_eq!(to, &store_head);
        }
        other => panic!("expected Replay, got {other:?}"),
    }
    let live_head = run_git(&recovered.path, &["rev-parse", "HEAD"])
        .await
        .trim()
        .to_owned();
    assert_eq!(live_head, store_head);
    assert!(!recovered.path.join("upstream.txt").exists());

    let actions = h.mgr.store().read_actions(&id).await.unwrap();
    assert!(matches!(
        actions.last().unwrap(),
        StoreAction::Reconcile { strategy: ReconcileStrategy::Replay, .. }
    ));
}

/// Acceptance criterion: workspace disk wiped (not just stale HEAD —
/// directory itself missing). Reconcile must rebuild via cold-resume and
/// report `ColdResume { reason: MissingDisk }`.
#[tokio::test]
async fn missing_workspace_triggers_cold_resume() {
    let h = build().await;
    let ws = h.mgr.acquire("alice", &h.repo_url).await.unwrap();
    let id = ws.id.clone();
    let path = ws.path.clone();
    ws.release().await.unwrap();
    h.mgr.cleanup(&ws).await.unwrap();
    assert!(!path.exists());

    let (recovered, outcome) = h.mgr.reconcile(&id).await.unwrap();
    assert_eq!(
        outcome,
        ReconcileOutcome::ColdResume {
            reason: ColdResumeReason::MissingDisk,
        }
    );
    assert!(recovered.path.exists());

    let actions = h.mgr.store().read_actions(&id).await.unwrap();
    assert!(matches!(
        actions.last().unwrap(),
        StoreAction::Reconcile { strategy: ReconcileStrategy::ColdResume, .. }
    ));
}

/// Acceptance criterion: user operates the workspace directly with git
/// (checkout a side branch, drop a local commit, etc.). Reconcile must
/// reset HEAD back to Store's recorded commit — Store is the truth.
#[tokio::test]
async fn user_local_commits_reconciled_from_store() {
    let h = build().await;
    let ws = h.mgr.acquire("alice", &h.repo_url).await.unwrap();
    let id = ws.id.clone();
    let path = ws.path.clone();
    let store_head = ws.metadata_snapshot().await.head_commit.clone();
    h.mgr
        .store()
        .write_metadata(&ws.metadata_snapshot().await)
        .await
        .unwrap();
    ws.release().await.unwrap();
    h.mgr.unregister(&id).await;

    // User branches off and adds a local commit, oblivious to Store.
    run_git(&path, &["checkout", "-b", "user/sidebar"]).await;
    tokio::fs::write(path.join("user-notes.md"), b"my private notes\n")
        .await
        .unwrap();
    run_git(&path, &["add", "-A"]).await;
    run_git(
        &path,
        &[
            "-c",
            "user.email=human@cir32.local",
            "-c",
            "user.name=human",
            "-c",
            "commit.gpgsign=false",
            "commit",
            "-m",
            "user local commit",
        ],
    )
    .await;
    let user_head = run_git(&path, &["rev-parse", "HEAD"]).await.trim().to_owned();
    assert_ne!(user_head, store_head);

    let (recovered, outcome) = h.mgr.reconcile(&id).await.unwrap();
    assert!(matches!(outcome, ReconcileOutcome::Replay { .. }));
    let live_head = run_git(&recovered.path, &["rev-parse", "HEAD"])
        .await
        .trim()
        .to_owned();
    assert_eq!(live_head, store_head);
    assert!(!recovered.path.join("user-notes.md").exists());
}
