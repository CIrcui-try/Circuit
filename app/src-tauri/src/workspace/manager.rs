use crate::workspace::errors::{Error, Result};
use crate::workspace::git_ops;
use crate::workspace::metadata::{WorkspaceId, WorkspaceMetadata};
use crate::workspace::store::{StoreAction, WorkspaceStore};
use crate::workspace::workspace::{Workspace, WorkspaceState};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::Mutex;

#[derive(Debug, Clone)]
pub struct WorkspaceManager {
    inner: Arc<Inner>,
}

#[derive(Debug)]
struct Inner {
    workspace_root: PathBuf,
    store: Arc<WorkspaceStore>,
    idle_ttl: Duration,
    registry: Mutex<HashMap<WorkspaceId, Arc<Workspace>>>,
}

impl WorkspaceManager {
    pub async fn new(
        workspace_root: impl Into<PathBuf>,
        store: WorkspaceStore,
        idle_ttl: Duration,
    ) -> Result<Self> {
        let workspace_root = workspace_root.into();
        tokio::fs::create_dir_all(&workspace_root).await?;
        Ok(Self {
            inner: Arc::new(Inner {
                workspace_root,
                store: Arc::new(store),
                idle_ttl,
                registry: Mutex::new(HashMap::new()),
            }),
        })
    }

    pub fn workspace_root(&self) -> &Path {
        &self.inner.workspace_root
    }

    pub fn store(&self) -> Arc<WorkspaceStore> {
        Arc::clone(&self.inner.store)
    }

    pub fn idle_ttl(&self) -> Duration {
        self.inner.idle_ttl
    }

    /// Acquire a workspace for `(user_id, repo_url)`.
    ///
    /// If an existing workspace for the pair is currently `Idle`, it is reused.
    /// If every existing workspace is `Attached`, a fresh clone is created at
    /// `<root>/<user_id>/<repo_slug>-<n>` so concurrent same-user-same-repo tasks
    /// stay isolated (per CIR-30 acceptance criteria).
    pub async fn acquire(&self, user_id: &str, repo_url: &str) -> Result<Arc<Workspace>> {
        let slug = repo_slug(repo_url);

        // Find an existing idle workspace for this user+repo, or pick the next free index.
        let chosen = {
            let registry = self.inner.registry.lock().await;
            let mut existing_indices: Vec<u32> = Vec::new();
            let mut idle_match: Option<Arc<Workspace>> = None;
            for (id, ws) in registry.iter() {
                if let Some(idx) = parse_index(&id.0, user_id, &slug) {
                    existing_indices.push(idx);
                    if idle_match.is_none() && ws.state().await == WorkspaceState::Idle {
                        idle_match = Some(Arc::clone(ws));
                    }
                }
            }
            if let Some(ws) = idle_match {
                Either::Reuse(ws)
            } else {
                let next_idx = existing_indices.iter().copied().max().map_or(0, |m| m + 1);
                Either::Create(next_idx)
            }
        };

        match chosen {
            Either::Reuse(ws) => {
                ws.attach().await?;
                self.inner
                    .store
                    .append_action(
                        &ws.id,
                        &StoreAction::Acquire {
                            head_commit: ws.metadata_snapshot().await.head_commit,
                            branch: ws.metadata_snapshot().await.branch,
                        },
                    )
                    .await?;
                Ok(ws)
            }
            Either::Create(next_idx) => {
                let id = WorkspaceId::new(user_id, &slug, next_idx);
                let path = self
                    .inner
                    .workspace_root
                    .join(user_id)
                    .join(format!("{}-{}", slug, next_idx));
                git_ops::clone(repo_url, &path).await?;
                let meta = WorkspaceMetadata::snapshot(
                    id.clone(),
                    user_id.to_owned(),
                    repo_url.to_owned(),
                    &path,
                )
                .await?;
                self.inner.store.write_metadata(&meta).await?;
                self.inner
                    .store
                    .append_action(
                        &id,
                        &StoreAction::Acquire {
                            head_commit: meta.head_commit.clone(),
                            branch: meta.branch.clone(),
                        },
                    )
                    .await?;
                let ws = Workspace::new(id.clone(), path, meta);
                ws.attach().await?;
                self.inner.registry.lock().await.insert(id, Arc::clone(&ws));
                Ok(ws)
            }
        }
    }

    pub async fn release(&self, ws: &Workspace) -> Result<()> {
        ws.release().await
    }

    pub async fn lookup(&self, id: &WorkspaceId) -> Option<Arc<Workspace>> {
        self.inner.registry.lock().await.get(id).cloned()
    }

    pub async fn registry_snapshot(&self) -> Vec<Arc<Workspace>> {
        self.inner.registry.lock().await.values().cloned().collect()
    }

    /// Graceful idle-TTL cleanup: snapshot working tree → stash dirty files →
    /// persist metadata + stash bundle to Store → wipe disk → mark Removed.
    ///
    /// Caller must own the workspace (it must be in Attached or Idle state) —
    /// the routine drives state through Cleaning → Removed.
    pub async fn cleanup(&self, ws: &Arc<Workspace>) -> Result<()> {
        // Transition to Cleaning, allowing both Idle (TTL-driven) and Attached (explicit) entry.
        {
            let mut g = ws.state_mut().await;
            match *g {
                WorkspaceState::Idle | WorkspaceState::Attached => {
                    *g = WorkspaceState::Cleaning;
                }
                WorkspaceState::Cleaning | WorkspaceState::Removed => return Ok(()),
                other => {
                    return Err(Error::InvalidState {
                        expected: "Idle|Attached".into(),
                        actual: format!("{other:?}"),
                    });
                }
            }
        }

        // Snapshot current state.
        let mut meta = WorkspaceMetadata::snapshot(
            ws.id.clone(),
            ws.metadata_snapshot().await.user_id.clone(),
            ws.metadata_snapshot().await.repo_url.clone(),
            &ws.path,
        )
        .await?;
        meta.last_turn = ws.metadata_snapshot().await.last_turn;

        // Stash dirty changes and persist the bundle so cold_resume can restore them.
        if !meta.dirty_files.is_empty() {
            if let Some(sha) = git_ops::stash_save(&ws.path, "cir30-cleanup").await? {
                let bundle = git_ops::export_stash_bundle(&ws.path, &sha).await?;
                self.inner
                    .store
                    .save_stash_blob(&ws.id, &sha, &bundle)
                    .await?;
                self.inner
                    .store
                    .append_action(
                        &ws.id,
                        &StoreAction::Stash {
                            stash_sha: sha.clone(),
                            dirty_files: meta.dirty_files.clone(),
                        },
                    )
                    .await?;
                meta.stash_ref = Some(sha);
            }
        }

        // Persist metadata BEFORE wiping disk.
        self.inner.store.write_metadata(&meta).await?;
        self.inner
            .store
            .append_action(&ws.id, &StoreAction::Cleanup)
            .await?;

        // Wipe the working directory. Path-escape guard: must be under root.
        ensure_inside(&self.inner.workspace_root, &ws.path)?;
        if ws.path.exists() {
            tokio::fs::remove_dir_all(&ws.path).await?;
        }

        // Update in-memory state and de-register.
        {
            let mut m = ws.metadata.write().await;
            *m = meta;
        }
        ws.set_state(WorkspaceState::Removed).await;
        self.inner.registry.lock().await.remove(&ws.id);
        Ok(())
    }

    pub(crate) async fn register(&self, ws: Arc<Workspace>) {
        self.inner.registry.lock().await.insert(ws.id.clone(), ws);
    }

    pub(crate) async fn unregister(&self, id: &WorkspaceId) -> Option<Arc<Workspace>> {
        self.inner.registry.lock().await.remove(id)
    }
}

enum Either {
    Reuse(Arc<Workspace>),
    Create(u32),
}

fn repo_slug(repo_url: &str) -> String {
    let trimmed = repo_url.trim_end_matches('/');
    let last = trimmed.rsplit('/').next().unwrap_or(trimmed);
    last.trim_end_matches(".git")
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.' {
                c
            } else {
                '_'
            }
        })
        .collect::<String>()
}

fn parse_index(id_str: &str, user_id: &str, slug: &str) -> Option<u32> {
    let prefix = format!("{user_id}__{slug}__");
    id_str.strip_prefix(&prefix)?.parse().ok()
}

fn ensure_inside(root: &Path, path: &Path) -> Result<()> {
    let root_canon = root.canonicalize().unwrap_or_else(|_| root.to_path_buf());
    let path_canon = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
    if path_canon.starts_with(&root_canon) {
        Ok(())
    } else {
        Err(Error::PathEscape(path_canon))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workspace::git_ops::init_repo_with_initial_commit;
    use tempfile::TempDir;

    async fn fixture() -> (TempDir, TempDir, WorkspaceManager, String) {
        let src = TempDir::new().unwrap();
        init_repo_with_initial_commit(src.path()).await.unwrap();
        let store_dir = TempDir::new().unwrap();
        let ws_root = TempDir::new().unwrap();
        let store = WorkspaceStore::open(store_dir.path()).await.unwrap();
        let mgr = WorkspaceManager::new(ws_root.path(), store, Duration::from_secs(60))
            .await
            .unwrap();
        let url = format!("file://{}", src.path().display());
        // keep TempDirs alive by returning them; bundle ws_root as second slot
        (src, ws_root, mgr, url)
    }

    #[tokio::test]
    async fn acquire_clones_and_attaches() {
        let (_src, _ws_root, mgr, url) = fixture().await;
        let ws = mgr.acquire("alice", &url).await.unwrap();
        assert_eq!(ws.state().await, WorkspaceState::Attached);
        assert!(ws.path.exists());
        assert!(ws.path.join("README.md").exists());
    }

    #[tokio::test]
    async fn attach_twice_rejects() {
        let (_src, _ws_root, mgr, url) = fixture().await;
        let ws = mgr.acquire("alice", &url).await.unwrap();
        let again = ws.attach().await;
        assert!(matches!(again, Err(Error::AlreadyAttached(_))));
    }

    #[tokio::test]
    async fn acquire_concurrent_creates_separate_clones() {
        let (_src, _ws_root, mgr, url) = fixture().await;
        let a = mgr.acquire("alice", &url).await.unwrap();
        // a is Attached → second acquire must NOT reuse, must spawn -1 clone
        let b = mgr.acquire("alice", &url).await.unwrap();
        assert_ne!(a.id, b.id);
        assert_ne!(a.path, b.path);
        assert!(a.path.exists() && b.path.exists());
        assert_eq!(a.state().await, WorkspaceState::Attached);
        assert_eq!(b.state().await, WorkspaceState::Attached);
    }

    #[tokio::test]
    async fn release_returns_to_idle_and_reused_on_next_acquire() {
        let (_src, _ws_root, mgr, url) = fixture().await;
        let a = mgr.acquire("alice", &url).await.unwrap();
        let id_a = a.id.clone();
        a.release().await.unwrap();
        assert_eq!(a.state().await, WorkspaceState::Idle);
        let a2 = mgr.acquire("alice", &url).await.unwrap();
        assert_eq!(a2.id, id_a);
        assert_eq!(a2.state().await, WorkspaceState::Attached);
    }

    #[test]
    fn repo_slug_strips_git_suffix_and_separators() {
        assert_eq!(repo_slug("https://github.com/foo/bar.git"), "bar");
        assert_eq!(repo_slug("file:///tmp/a/b/"), "b");
        assert_eq!(repo_slug("git@github.com:foo/baz.git"), "baz");
    }

    #[tokio::test]
    async fn cleanup_clean_repo_persists_metadata_and_wipes_disk() {
        let (_src, _ws_root, mgr, url) = fixture().await;
        let ws = mgr.acquire("alice", &url).await.unwrap();
        let id = ws.id.clone();
        let path = ws.path.clone();
        ws.release().await.unwrap();
        mgr.cleanup(&ws).await.unwrap();
        assert_eq!(ws.state().await, WorkspaceState::Removed);
        assert!(!path.exists());
        let meta = mgr.store().read_metadata(&id).await.unwrap().unwrap();
        assert!(meta.stash_ref.is_none());
        assert!(mgr.lookup(&id).await.is_none());
    }

    #[tokio::test]
    async fn cleanup_dirty_repo_persists_stash_bundle() {
        let (_src, _ws_root, mgr, url) = fixture().await;
        let ws = mgr.acquire("alice", &url).await.unwrap();
        tokio::fs::write(ws.path.join("dirty.txt"), b"WIP\n")
            .await
            .unwrap();
        tokio::fs::write(ws.path.join("README.md"), b"# changed\n")
            .await
            .unwrap();
        ws.release().await.unwrap();
        mgr.cleanup(&ws).await.unwrap();
        let meta = mgr
            .store()
            .read_metadata(&ws.id)
            .await
            .unwrap()
            .unwrap();
        let sha = meta.stash_ref.expect("stash sha persisted");
        let bundle = mgr
            .store()
            .load_stash_blob(&ws.id, &sha)
            .await
            .unwrap()
            .expect("bundle persisted");
        assert!(!bundle.is_empty());
        let names: Vec<_> = meta
            .dirty_files
            .iter()
            .map(|p| p.to_string_lossy().into_owned())
            .collect();
        assert!(names.iter().any(|n| n == "dirty.txt"));
        assert!(names.iter().any(|n| n == "README.md"));
    }
}
