//! Phase 5 (CIR-33): pre-cloned workspace warm pool.
//!
//! Decision doc: `docs/research/CIR-33-warm-pool-strategy.md`.
//!
//! Slots are keyed by `(user_id, repo_url)` so warm resources are never
//! shared across users. `take` returns the oldest slot for a key (FIFO
//! within a key); over-cap `put` returns the slot the pool decided to
//! evict so the caller (`WorkspaceManager`) can route it through the
//! existing `cleanup` path. The pool itself never touches disk — it only
//! holds in-memory `Arc<Workspace>` handles plus accounting.
//!
//! Eviction = LRU across the whole pool. We don't keep a separate LRU
//! deque; with the small `max_total` decided in §3.2 of the strategy doc
//! a single linear scan over the slots is cheaper than the bookkeeping.

use crate::workspace::workspace::Workspace;
use std::collections::{HashMap, VecDeque};
use std::sync::Arc;
use std::time::Instant;
use tokio::sync::Mutex;

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct PoolKey {
    pub user_id: String,
    pub repo_url: String,
}

impl PoolKey {
    pub fn new(user_id: impl Into<String>, repo_url: impl Into<String>) -> Self {
        Self {
            user_id: user_id.into(),
            repo_url: repo_url.into(),
        }
    }
}

#[derive(Debug)]
pub struct PooledSlot {
    pub workspace: Arc<Workspace>,
    pub last_used: Instant,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct PoolStats {
    pub hits: u64,
    pub misses: u64,
    pub evictions: u64,
    pub size: usize,
}

#[derive(Debug)]
pub struct WarmPool {
    inner: Mutex<Inner>,
}

#[derive(Debug)]
struct Inner {
    slots: HashMap<PoolKey, VecDeque<PooledSlot>>,
    max_per_key: usize,
    max_total: usize,
    hits: u64,
    misses: u64,
    evictions: u64,
}

impl WarmPool {
    pub fn new(max_per_key: usize, max_total: usize) -> Self {
        assert!(max_per_key > 0, "max_per_key must be > 0");
        assert!(
            max_total >= max_per_key,
            "max_total must be >= max_per_key"
        );
        Self {
            inner: Mutex::new(Inner {
                slots: HashMap::new(),
                max_per_key,
                max_total,
                hits: 0,
                misses: 0,
                evictions: 0,
            }),
        }
    }

    /// Pop the oldest slot for `key`, or `None` if the key has no slots.
    pub async fn take(&self, key: &PoolKey) -> Option<PooledSlot> {
        let mut g = self.inner.lock().await;
        match g.slots.get_mut(key).and_then(|q| q.pop_front()) {
            Some(slot) => {
                g.hits += 1;
                if g.slots.get(key).is_some_and(|q| q.is_empty()) {
                    g.slots.remove(key);
                }
                Some(slot)
            }
            None => {
                g.misses += 1;
                None
            }
        }
    }

    /// Insert `slot` under `key`. If adding the slot would exceed
    /// `max_per_key` (within the key) or `max_total` (overall), the pool
    /// removes its globally-oldest slot first and returns it as the
    /// caller's responsibility to clean up. The returned slot is *never*
    /// the one being inserted — `put` always succeeds in storing it.
    pub async fn put(&self, key: PoolKey, slot: PooledSlot) -> Option<PooledSlot> {
        let mut g = self.inner.lock().await;

        let evicted_for_key = if g
            .slots
            .get(&key)
            .map(|q| q.len() >= g.max_per_key)
            .unwrap_or(false)
        {
            g.slots.get_mut(&key).and_then(|q| q.pop_front())
        } else {
            None
        };

        let total_after_per_key_evict: usize = g.slots.values().map(|q| q.len()).sum();
        let evicted_global = if total_after_per_key_evict + 1 > g.max_total {
            evict_globally_oldest(&mut g.slots)
        } else {
            None
        };

        g.slots.entry(key).or_default().push_back(slot);

        let evicted = evicted_for_key.or(evicted_global);
        if evicted.is_some() {
            g.evictions += 1;
        }
        evicted
    }

    pub async fn stats(&self) -> PoolStats {
        let g = self.inner.lock().await;
        PoolStats {
            hits: g.hits,
            misses: g.misses,
            evictions: g.evictions,
            size: g.slots.values().map(|q| q.len()).sum(),
        }
    }
}

fn evict_globally_oldest(
    slots: &mut HashMap<PoolKey, VecDeque<PooledSlot>>,
) -> Option<PooledSlot> {
    let oldest_key = slots
        .iter()
        .filter_map(|(k, q)| q.front().map(|s| (k.clone(), s.last_used)))
        .min_by_key(|(_, t)| *t)
        .map(|(k, _)| k)?;
    let popped = slots.get_mut(&oldest_key).and_then(|q| q.pop_front());
    if slots.get(&oldest_key).is_some_and(|q| q.is_empty()) {
        slots.remove(&oldest_key);
    }
    popped
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workspace::metadata::{WorkspaceId, WorkspaceMetadata};
    use std::path::PathBuf;
    use std::time::Duration;

    fn make_slot(user: &str, repo: &str, n: u32, last_used: Instant) -> (PoolKey, PooledSlot) {
        let id = WorkspaceId::new(user, repo, n);
        let meta = WorkspaceMetadata::empty(id.clone(), user.into(), format!("file:///{repo}"));
        let ws = Workspace::new(id, PathBuf::from(format!("/tmp/{user}/{repo}-{n}")), meta);
        let key = PoolKey::new(user, format!("file:///{repo}"));
        (key, PooledSlot { workspace: ws, last_used })
    }

    #[tokio::test]
    async fn take_returns_none_on_empty_and_records_miss() {
        let pool = WarmPool::new(2, 4);
        let k = PoolKey::new("alice", "file:///r");
        assert!(pool.take(&k).await.is_none());
        assert_eq!(pool.stats().await.misses, 1);
        assert_eq!(pool.stats().await.hits, 0);
    }

    #[tokio::test]
    async fn put_then_take_round_trips_and_records_hit() {
        let pool = WarmPool::new(2, 4);
        let (k, slot) = make_slot("alice", "r", 0, Instant::now());
        let evicted = pool.put(k.clone(), slot).await;
        assert!(evicted.is_none());
        let taken = pool.take(&k).await.expect("hit expected");
        assert_eq!(taken.workspace.id.0, "alice__r__0");
        let s = pool.stats().await;
        assert_eq!(s.hits, 1);
        assert_eq!(s.size, 0);
    }

    #[tokio::test]
    async fn isolation_per_user() {
        let pool = WarmPool::new(2, 4);
        let (k_alice, slot) = make_slot("alice", "r", 0, Instant::now());
        pool.put(k_alice, slot).await;

        let k_bob = PoolKey::new("bob", "file:///r");
        assert!(pool.take(&k_bob).await.is_none(), "bob must not see alice's slot");
        assert_eq!(pool.stats().await.size, 1, "alice's slot still in pool");
    }

    #[tokio::test]
    async fn over_max_per_key_evicts_oldest_for_key() {
        let pool = WarmPool::new(2, 8);
        let t0 = Instant::now();
        let (k, s0) = make_slot("alice", "r", 0, t0);
        let (_, s1) = make_slot("alice", "r", 1, t0 + Duration::from_millis(10));
        let (_, s2) = make_slot("alice", "r", 2, t0 + Duration::from_millis(20));
        assert!(pool.put(k.clone(), s0).await.is_none());
        assert!(pool.put(k.clone(), s1).await.is_none());
        let evicted = pool.put(k.clone(), s2).await.expect("over-cap evict");
        assert_eq!(evicted.workspace.id.0, "alice__r__0");
        assert_eq!(pool.stats().await.evictions, 1);
    }

    #[tokio::test]
    async fn over_max_total_evicts_globally_oldest() {
        let pool = WarmPool::new(2, 2);
        let t0 = Instant::now();
        let (k_a, s_a) = make_slot("alice", "r", 0, t0);
        let (k_b, s_b) = make_slot("bob", "r", 0, t0 + Duration::from_millis(10));
        let (k_c, s_c) = make_slot("carol", "r", 0, t0 + Duration::from_millis(20));
        pool.put(k_a, s_a).await;
        pool.put(k_b, s_b).await;
        let evicted = pool.put(k_c, s_c).await.expect("global evict");
        assert_eq!(evicted.workspace.id.0, "alice__r__0", "alice was oldest");
        let s = pool.stats().await;
        assert_eq!(s.size, 2);
        assert_eq!(s.evictions, 1);
    }
}
