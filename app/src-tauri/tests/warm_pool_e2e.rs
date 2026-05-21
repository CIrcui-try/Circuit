//! Phase 5 (CIR-33): warm pool integration scenarios.
//!
//! Mirrors the structure of the other workspace e2e suites: real temp git
//! repo + real Store + real WorkspaceManager. Adds a `WarmPool` and exercises
//! the four behaviours nailed in the strategy doc — pool hit on second
//! acquire, per-user isolation, LRU eviction across keys, and the mid-turn
//! release rejection that protects pool invariants.

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
    mgr: WorkspaceManager,
    repo_url: String,
}

async fn build(pool: Arc<WarmPool>) -> Harness {
    let src = TempDir::new().unwrap();
    init_repo_with_initial_commit(src.path()).await.unwrap();
    let store_dir = TempDir::new().unwrap();
    let ws_root = TempDir::new().unwrap();
    let store = WorkspaceStore::open(store_dir.path()).await.unwrap();
    let mgr = WorkspaceManager::new(ws_root.path(), store, Duration::from_secs(60))
        .await
        .unwrap()
        .with_pool(pool);
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
async fn pool_hit_on_second_acquire_skips_clone() {
    let pool = Arc::new(WarmPool::new(2, 4));
    let h = build(Arc::clone(&pool)).await;

    let ws1 = h.mgr.acquire("alice", &h.repo_url).await.unwrap();
    assert_eq!(ws1.state().await, WorkspaceState::Attached);
    assert_eq!(pool.stats().await.misses, 1);
    assert_eq!(pool.stats().await.hits, 0);

    h.mgr.release_to_pool(&ws1).await.unwrap();
    assert_eq!(pool.stats().await.size, 1);

    let ws2 = h.mgr.acquire("alice", &h.repo_url).await.unwrap();
    assert_eq!(ws2.state().await, WorkspaceState::Attached);
    assert_eq!(ws2.id, ws1.id, "second acquire must reuse the pooled slot");
    let s = pool.stats().await;
    assert_eq!(s.hits, 1, "second acquire is a pool hit");
    assert_eq!(s.misses, 1);
    assert_eq!(s.size, 0, "pool drained after take");
}

#[tokio::test]
async fn pool_isolates_users_by_key() {
    let pool = Arc::new(WarmPool::new(2, 4));
    let h = build(Arc::clone(&pool)).await;

    let alice = h.mgr.acquire("alice", &h.repo_url).await.unwrap();
    h.mgr.release_to_pool(&alice).await.unwrap();
    assert_eq!(pool.stats().await.size, 1);

    // Bob acquiring the same repo URL must not pick up alice's pooled slot.
    let bob = h.mgr.acquire("bob", &h.repo_url).await.unwrap();
    assert_ne!(bob.id, alice.id, "bob must get a fresh clone, not alice's slot");
    let s = pool.stats().await;
    assert_eq!(s.misses, 2, "alice's first + bob's both missed");
    assert_eq!(s.hits, 0);
    assert_eq!(s.size, 1, "alice's slot is still in the pool");
}

#[tokio::test]
async fn pool_evicts_lru_slot_when_total_cap_exceeded() {
    // max_total = 1 → second release_to_pool must evict the first slot.
    let pool = Arc::new(WarmPool::new(1, 1));
    let h = build(Arc::clone(&pool)).await;

    let alice = h.mgr.acquire("alice", &h.repo_url).await.unwrap();
    let alice_disk = alice.path.clone();
    h.mgr.release_to_pool(&alice).await.unwrap();
    assert_eq!(pool.stats().await.size, 1);
    assert!(alice_disk.exists(), "alice's disk lives while she's in the pool");

    let bob = h.mgr.acquire("bob", &h.repo_url).await.unwrap();
    h.mgr.release_to_pool(&bob).await.unwrap();
    let s = pool.stats().await;
    assert_eq!(s.size, 1, "alice was evicted to make room for bob");
    assert_eq!(s.evictions, 1);
    assert!(
        !alice_disk.exists(),
        "alice's evicted slot must be wiped via the cleanup path"
    );

    // Alice acquiring again must miss the pool — her slot is gone.
    let _alice2 = h.mgr.acquire("alice", &h.repo_url).await.unwrap();
    let s = pool.stats().await;
    assert_eq!(
        s.misses, 3,
        "alice's first + bob's + alice's re-acquire all miss the pool"
    );
    assert_eq!(s.hits, 0, "no hits in this scenario");
}

#[tokio::test]
async fn release_to_pool_rejects_mid_turn_workspace() {
    let pool = Arc::new(WarmPool::new(2, 4));
    let h = build(Arc::clone(&pool)).await;

    let ws = h.mgr.acquire("alice", &h.repo_url).await.unwrap();
    h.mgr.begin_turn(&ws, 1).await.unwrap();

    let err = h.mgr.release_to_pool(&ws).await.unwrap_err();
    assert!(
        matches!(err, app_lib::workspace::Error::TurnInFlight(_)),
        "mid-turn release must be rejected, got: {err:?}"
    );
    assert_eq!(pool.stats().await.size, 0, "rejected slot must not enter pool");
}

#[tokio::test]
async fn prewarm_populates_pool_for_subsequent_hits() {
    let pool = Arc::new(WarmPool::new(2, 4));
    let h = build(Arc::clone(&pool)).await;

    h.mgr.prewarm("alice", &h.repo_url, 2).await.unwrap();
    let s = pool.stats().await;
    assert_eq!(s.size, 2, "prewarm filled two slots");

    // Two acquires in a row must both hit, no fresh clone needed.
    let _ws1 = h.mgr.acquire("alice", &h.repo_url).await.unwrap();
    let _ws2 = h.mgr.acquire("alice", &h.repo_url).await.unwrap();
    let s = pool.stats().await;
    assert!(s.hits >= 2, "both acquires hit, hits={}", s.hits);
}
