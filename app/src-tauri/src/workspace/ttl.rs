use crate::workspace::manager::WorkspaceManager;
use crate::workspace::metadata::WorkspaceId;
use crate::workspace::workspace::{Workspace, WorkspaceState};
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Copy)]
pub struct IdleTtlConfig {
    pub ttl: Duration,
    pub poll_interval: Duration,
}

impl Default for IdleTtlConfig {
    fn default() -> Self {
        Self {
            ttl: Duration::from_secs(15 * 60),
            poll_interval: Duration::from_secs(30),
        }
    }
}

/// Inspect a workspace's last turn boundary and decide whether it has crossed
/// the idle TTL.
///
/// Phase 3 (CIR-31): a workspace with an in-flight turn is **never** treated
/// as expired regardless of its `last_turn` age — that enforces the
/// "evict only on turn boundary" acceptance criterion.
pub async fn is_idle_expired(ws: &Workspace, ttl: Duration, now: SystemTime) -> bool {
    if ws.active_turn().await.is_some() {
        return false;
    }
    let snapshot = ws.metadata_snapshot().await;
    match snapshot.last_turn {
        // Never had a turn → don't auto-cleanup. Phase 2 leaves cold-start-only
        // workspaces alive until explicitly released.
        None => false,
        Some(turn) => {
            let now_ms = now.duration_since(UNIX_EPOCH).map_or(0, |d| d.as_millis());
            now_ms.saturating_sub(turn.at_unix_ms) >= ttl.as_millis()
        }
    }
}

/// Single sweep over the manager's registered workspaces; runs `cleanup` on
/// any whose last turn boundary is older than `ttl` AND that are currently Idle.
pub async fn tick(mgr: &WorkspaceManager, ttl: Duration) -> Vec<WorkspaceId> {
    let now = SystemTime::now();
    let mut victims = Vec::new();
    let candidates: Vec<Arc<Workspace>> = mgr.registry_snapshot().await;
    for ws in candidates {
        if !matches!(ws.state().await, WorkspaceState::Idle) {
            continue;
        }
        if !is_idle_expired(&ws, ttl, now).await {
            continue;
        }
        if mgr.cleanup(&ws).await.is_ok() {
            victims.push(ws.id.clone());
        }
    }
    victims
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workspace::git_ops::init_repo_with_initial_commit;
    use crate::workspace::metadata::TurnBoundary;
    use crate::workspace::store::WorkspaceStore;
    use tempfile::TempDir;

    async fn build() -> (TempDir, TempDir, WorkspaceManager, String) {
        let src = TempDir::new().unwrap();
        init_repo_with_initial_commit(src.path()).await.unwrap();
        let store_dir = TempDir::new().unwrap();
        let ws_root = TempDir::new().unwrap();
        let store = WorkspaceStore::open(store_dir.path()).await.unwrap();
        let mgr = WorkspaceManager::new(ws_root.path(), store, Duration::from_secs(60))
            .await
            .unwrap();
        let url = format!("file://{}", src.path().display());
        (src, ws_root, mgr, url)
    }

    #[tokio::test]
    async fn idle_with_no_turn_is_not_expired() {
        let (_src, _root, mgr, url) = build().await;
        let ws = mgr.acquire("alice", &url).await.unwrap();
        ws.release().await.unwrap();
        assert!(!is_idle_expired(&ws, Duration::from_secs(0), SystemTime::now()).await);
    }

    #[tokio::test]
    async fn turn_older_than_ttl_is_expired() {
        let (_src, _root, mgr, url) = build().await;
        let ws = mgr.acquire("alice", &url).await.unwrap();
        ws.record_turn(TurnBoundary {
            turn_index: 1,
            at_unix_ms: 1_000, // ancient
        })
        .await;
        ws.release().await.unwrap();
        let now = SystemTime::UNIX_EPOCH + Duration::from_secs(60 * 60);
        assert!(is_idle_expired(&ws, Duration::from_secs(60), now).await);
    }

    #[tokio::test]
    async fn tick_cleans_only_expired_idle_workspaces() {
        let (_src, _root, mgr, url) = build().await;
        // Acquire both BEFORE releasing — that way they get separate clones.
        let stale = mgr.acquire("alice", &url).await.unwrap();
        let busy = mgr.acquire("alice", &url).await.unwrap();
        assert_ne!(stale.id, busy.id);
        for ws in [&stale, &busy] {
            ws.record_turn(TurnBoundary {
                turn_index: 1,
                at_unix_ms: 1_000,
            })
            .await;
        }
        // Only `stale` becomes Idle; `busy` stays Attached.
        stale.release().await.unwrap();
        let victims = tick(&mgr, Duration::from_millis(0)).await;
        assert_eq!(victims.len(), 1, "only the Idle workspace should be cleaned");
        assert_eq!(victims[0], stale.id);
        assert!(mgr.lookup(&stale.id).await.is_none());
        assert!(mgr.lookup(&busy.id).await.is_some());
    }

    #[tokio::test]
    async fn idle_with_in_flight_turn_is_not_expired() {
        let (_src, _root, mgr, url) = build().await;
        let ws = mgr.acquire("alice", &url).await.unwrap();
        // Ancient last_turn — but a turn is in flight, so TTL must NOT fire.
        ws.record_turn(TurnBoundary {
            turn_index: 1,
            at_unix_ms: 1_000,
        })
        .await;
        ws.begin_turn(2, "stub-base".into()).await.unwrap();

        let now = SystemTime::UNIX_EPOCH + Duration::from_secs(60 * 60);
        assert!(!is_idle_expired(&ws, Duration::from_secs(60), now).await);
    }

    #[tokio::test]
    async fn tick_skips_workspace_with_in_flight_turn_even_if_idle() {
        let (_src, _root, mgr, url) = build().await;
        let ws = mgr.acquire("alice", &url).await.unwrap();
        // Set ancient last_turn so TTL would otherwise fire.
        ws.record_turn(TurnBoundary {
            turn_index: 1,
            at_unix_ms: 1_000,
        })
        .await;
        // Begin a new turn but don't commit; release the workspace lock so it's
        // formally Idle. The active_turn marker must still block cleanup —
        // mid-turn evicts are explicitly forbidden by CIR-31.
        ws.begin_turn(2, "stub-base".into()).await.unwrap();
        ws.release().await.unwrap();

        let victims = tick(&mgr, Duration::from_millis(0)).await;
        assert!(
            victims.is_empty(),
            "in-flight workspace must not be evicted"
        );
        assert!(mgr.lookup(&ws.id).await.is_some());
    }
}
