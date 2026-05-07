use crate::workspace::errors::{Error, Result};
use crate::workspace::git_ops;
use crate::workspace::metadata::{WorkspaceId, WorkspaceMetadata};
use crate::workspace::store::{ReconcileStrategy, StoreAction, WorkspaceStore};
use crate::workspace::workspace::{Workspace, WorkspaceState};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::Mutex;

/// Phase 4 (CIR-32): typed result of `WorkspaceManager::reconcile`.
///
/// Each variant maps 1:1 to a branch of the divergence policy:
///
/// 1. `HeadMatch` — Store metadata's `head_commit` equals the workspace's
///    `git rev-parse HEAD`. Nothing was changed on disk; the workspace is
///    re-registered as `Idle` and reusable.
/// 2. `Replay` — disk exists but HEAD diverged (external push, user
///    `git commit`, branch switch, etc.). The workspace was reset_hard'd to
///    `to` (= Store's recorded head) and any persisted stash was re-applied.
/// 3. `ColdResume { reason }` — disk was wiped or unreadable, so the
///    workspace was rebuilt from Store metadata via `cold_resume`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ReconcileOutcome {
    HeadMatch,
    Replay { from: String, to: String },
    ColdResume { reason: ColdResumeReason },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ColdResumeReason {
    /// Workspace directory does not exist.
    MissingDisk,
    /// `git rev-parse HEAD` failed (`.git` corrupt / not a git repo).
    HeadUnreadable,
    /// In-place `Replay` was attempted but a git op failed; we fell back to
    /// a full re-clone.
    ReplayFailed,
}

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

    /// Begin a turn on `ws`. Captures HEAD as the rollback target, marks the
    /// in-flight turn on the workspace, and writes a `TurnBegin` action to the
    /// log so a crash before the matching `commit_turn` is recoverable.
    pub async fn begin_turn(&self, ws: &Workspace, turn_index: u64) -> Result<()> {
        let base_head = git_ops::head_commit(&ws.path).await?;
        ws.begin_turn(turn_index, base_head.clone()).await?;
        self.inner
            .store
            .append_action(
                &ws.id,
                &StoreAction::TurnBegin {
                    turn_index,
                    base_head,
                },
            )
            .await?;
        Ok(())
    }

    /// Settle the in-flight turn: turn the dirty changes into a real git
    /// commit (so the boundary is a stable checkpoint), clear the in-flight
    /// marker, persist the bumped `last_turn` + new HEAD to the Store, and
    /// write a `TurnComplete` action. After this call returns, recovery
    /// treats the turn as a hard checkpoint that survives crashes.
    pub async fn commit_turn(&self, ws: &Workspace) -> Result<()> {
        let boundary = ws.commit_turn().await?;
        let dirty_files = git_ops::status(&ws.path)
            .await?
            .into_iter()
            .map(|e| e.path)
            .collect::<Vec<_>>();
        git_ops::commit_all(&ws.path, &format!("turn {} (CIR-31)", boundary.turn_index))
            .await?;
        let head_commit = git_ops::head_commit(&ws.path).await?;
        // Refresh metadata so the persisted head_commit matches the new commit.
        {
            let mut m = ws.metadata.write().await;
            m.head_commit.clone_from(&head_commit);
        }
        let snapshot = ws.metadata_snapshot().await;
        self.inner.store.write_metadata(&snapshot).await?;
        self.inner
            .store
            .append_action(
                &ws.id,
                &StoreAction::TurnComplete {
                    turn_index: boundary.turn_index,
                    head_commit,
                    dirty_files,
                },
            )
            .await?;
        Ok(())
    }

    pub async fn lookup(&self, id: &WorkspaceId) -> Option<Arc<Workspace>> {
        self.inner.registry.lock().await.get(id).cloned()
    }

    pub async fn registry_snapshot(&self) -> Vec<Arc<Workspace>> {
        self.inner.registry.lock().await.values().cloned().collect()
    }

    /// Cold-path resume: re-create a workspace from persisted metadata only.
    /// re-clone the repo URL → checkout the recorded HEAD commit → if a stash
    /// bundle was saved during cleanup, import + apply it so dirty files
    /// reappear. Returns the rebuilt workspace in `Idle` state.
    pub async fn cold_resume(&self, meta: &WorkspaceMetadata) -> Result<Arc<Workspace>> {
        let path = meta.disk_path.clone();
        if path.exists() {
            // Stale residue from a partial crash → wipe and re-clone fresh.
            ensure_inside(&self.inner.workspace_root, &path)?;
            tokio::fs::remove_dir_all(&path).await?;
        }
        git_ops::clone(&meta.repo_url, &path).await?;
        git_ops::checkout(&path, &meta.head_commit).await?;

        let mut applied_sha: Option<String> = None;
        if let Some(sha) = meta.stash_ref.clone() {
            if let Some(bundle) = self.inner.store.load_stash_blob(&meta.id, &sha).await? {
                git_ops::import_stash_bundle(&path, &bundle).await?;
                git_ops::stash_apply(&path, &sha).await?;
                applied_sha = Some(sha);
            }
        }

        // Rebuild metadata against the freshly-cloned working tree, but keep
        // the persisted stash_ref + last_turn — those describe the prior session.
        let live_meta = WorkspaceMetadata::snapshot(
            meta.id.clone(),
            meta.user_id.clone(),
            meta.repo_url.clone(),
            &path,
        )
        .await?;
        let merged = WorkspaceMetadata {
            stash_ref: meta.stash_ref.clone(),
            last_turn: meta.last_turn,
            ..live_meta
        };
        self.inner.store.write_metadata(&merged).await?;
        self.inner
            .store
            .append_action(
                &meta.id,
                &StoreAction::ColdResume {
                    head_commit: merged.head_commit.clone(),
                    stash_applied: applied_sha,
                },
            )
            .await?;
        Ok(Workspace::new(meta.id.clone(), path, merged))
    }

    /// Attempt to restore an in-memory `Workspace` for `id` after a crash.
    ///
    /// Phase 4 (CIR-32) made this a thin wrapper around [`reconcile`], which
    /// returns a typed [`ReconcileOutcome`]. Use `reconcile` directly if you
    /// need to know which branch of the divergence policy ran (e.g. for
    /// telemetry); use `recover` when you only want the workspace back.
    pub async fn recover(&self, id: &WorkspaceId) -> Result<Arc<Workspace>> {
        let (ws, _) = self.reconcile(id).await?;
        Ok(ws)
    }

    /// Phase 4 (CIR-32): single source of truth for the Store ↔ Workspace
    /// divergence policy. **Store wins, Workspace is derived.**
    ///
    /// Decision tree:
    /// 1. No metadata in Store → `Error::NotFound`. Caller decides what to do
    ///    (e.g. drop, or treat as fresh acquire).
    /// 2. Metadata exists, disk path exists, and `git rev-parse HEAD` matches
    ///    `meta.head_commit` → [`ReconcileOutcome::HeadMatch`]. Workspace is
    ///    re-registered as `Idle` and reusable, no disk mutation.
    /// 3. Metadata exists, disk path exists, but HEAD diverged (external
    ///    push, user `git commit`, etc.) → [`ReconcileOutcome::Replay`].
    ///    `git reset --hard meta.head_commit` + re-apply persisted stash if
    ///    any. If the replay's git ops fail, fall back to cold-resume with
    ///    [`ColdResumeReason::ReplayFailed`].
    /// 4. Metadata exists, disk gone or `.git` unreadable →
    ///    [`ReconcileOutcome::ColdResume`] via [`cold_resume`]. The variant's
    ///    `reason` distinguishes [`ColdResumeReason::MissingDisk`] from
    ///    [`ColdResumeReason::HeadUnreadable`].
    ///
    /// In every successful branch a [`StoreAction::Reconcile`] is appended so
    /// the action log is self-describing. Phase 3 (CIR-31) pending-turn
    /// rollback still runs first — the in-flight turn is undone and a
    /// [`StoreAction::TurnRollback`] precedes the `Reconcile` entry.
    pub async fn reconcile(
        &self,
        id: &WorkspaceId,
    ) -> Result<(Arc<Workspace>, ReconcileOutcome)> {
        let meta = self
            .inner
            .store
            .read_metadata(id)
            .await?
            .ok_or_else(|| Error::NotFound(id.0.clone()))?;
        let path = meta.disk_path.clone();

        let disk_state = self.classify_disk(&path, &meta.head_commit).await;
        let actions = self.inner.store.read_actions(id).await?;
        let pending = pending_turn_from_log(&actions);

        let (ws, outcome) = match disk_state {
            DiskState::HeadMatch => {
                self.handle_pending_turn_in_place(id, &path, &pending).await?;
                let ws = self.snapshot_workspace(id, &meta, &path).await?;
                (ws, ReconcileOutcome::HeadMatch)
            }
            DiskState::HeadDiverged { live_head } => {
                match self.try_replay(id, &meta, &path, &pending).await {
                    Ok(()) => {
                        let ws = self.snapshot_workspace(id, &meta, &path).await?;
                        (
                            ws,
                            ReconcileOutcome::Replay {
                                from: live_head,
                                to: meta.head_commit.clone(),
                            },
                        )
                    }
                    Err(_) => {
                        let ws = self.cold_resume_with_pending(&meta, &pending).await?;
                        (
                            ws,
                            ReconcileOutcome::ColdResume {
                                reason: ColdResumeReason::ReplayFailed,
                            },
                        )
                    }
                }
            }
            DiskState::HeadUnreadable => {
                let ws = self.cold_resume_with_pending(&meta, &pending).await?;
                (
                    ws,
                    ReconcileOutcome::ColdResume {
                        reason: ColdResumeReason::HeadUnreadable,
                    },
                )
            }
            DiskState::Missing => {
                let ws = self.cold_resume_with_pending(&meta, &pending).await?;
                (
                    ws,
                    ReconcileOutcome::ColdResume {
                        reason: ColdResumeReason::MissingDisk,
                    },
                )
            }
        };

        let (strategy, before_head) = match &outcome {
            ReconcileOutcome::HeadMatch => (ReconcileStrategy::HeadMatch, Some(meta.head_commit.clone())),
            ReconcileOutcome::Replay { from, .. } => (ReconcileStrategy::Replay, Some(from.clone())),
            ReconcileOutcome::ColdResume { .. } => (ReconcileStrategy::ColdResume, None),
        };
        self.inner
            .store
            .append_action(
                id,
                &StoreAction::Reconcile {
                    strategy,
                    before_head,
                    after_head: meta.head_commit.clone(),
                },
            )
            .await?;

        self.register(Arc::clone(&ws)).await;
        Ok((ws, outcome))
    }

    async fn classify_disk(&self, path: &Path, expected_head: &str) -> DiskState {
        if !path.exists() {
            return DiskState::Missing;
        }
        match git_ops::head_commit(path).await {
            Ok(head) if head == expected_head => DiskState::HeadMatch,
            Ok(head) => DiskState::HeadDiverged { live_head: head },
            Err(_) => DiskState::HeadUnreadable,
        }
    }

    /// Replay branch: disk is intact but HEAD diverged. Reset to Store's
    /// recorded head, restore any persisted stash, and roll back a pending
    /// turn if the action log left one open. Failures bubble up so the
    /// caller can demote to `ColdResume { reason: ReplayFailed }`.
    async fn try_replay(
        &self,
        id: &WorkspaceId,
        meta: &WorkspaceMetadata,
        path: &Path,
        pending: &Option<(u64, String)>,
    ) -> Result<()> {
        ensure_inside(&self.inner.workspace_root, path)?;
        // For an in-flight turn, reset to the turn's base_head (which equals
        // or precedes meta.head_commit) — same target as the existing pending
        // rollback flow. Otherwise reset to Store's recorded head.
        let target = pending
            .as_ref()
            .map(|(_, h)| h.clone())
            .unwrap_or_else(|| meta.head_commit.clone());
        git_ops::reset_hard(path, &target).await?;

        if let Some((turn_index, base_head)) = pending {
            self.inner
                .store
                .append_action(
                    id,
                    &StoreAction::TurnRollback {
                        turn_index: *turn_index,
                        rolled_back_to: base_head.clone(),
                    },
                )
                .await?;
        }

        if let Some(sha) = meta.stash_ref.clone() {
            // The bundle may already be in the object DB (no-op import) or
            // not (loose disk after manual reclone). Try import + apply; on
            // any failure the caller demotes to cold-resume.
            if let Some(bundle) = self.inner.store.load_stash_blob(&meta.id, &sha).await? {
                git_ops::import_stash_bundle(path, &bundle).await?;
                git_ops::stash_apply(path, &sha).await?;
            }
        }
        Ok(())
    }

    async fn handle_pending_turn_in_place(
        &self,
        id: &WorkspaceId,
        path: &Path,
        pending: &Option<(u64, String)>,
    ) -> Result<()> {
        if let Some((turn_index, base_head)) = pending {
            ensure_inside(&self.inner.workspace_root, path)?;
            git_ops::reset_hard(path, base_head).await?;
            self.inner
                .store
                .append_action(
                    id,
                    &StoreAction::TurnRollback {
                        turn_index: *turn_index,
                        rolled_back_to: base_head.clone(),
                    },
                )
                .await?;
        }
        Ok(())
    }

    async fn snapshot_workspace(
        &self,
        id: &WorkspaceId,
        meta: &WorkspaceMetadata,
        path: &Path,
    ) -> Result<Arc<Workspace>> {
        let live_meta = WorkspaceMetadata::snapshot(
            id.clone(),
            meta.user_id.clone(),
            meta.repo_url.clone(),
            path,
        )
        .await?;
        let merged = WorkspaceMetadata {
            stash_ref: meta.stash_ref.clone(),
            last_turn: meta.last_turn,
            ..live_meta
        };
        Ok(Workspace::new(id.clone(), path.to_path_buf(), merged))
    }

    async fn cold_resume_with_pending(
        &self,
        meta: &WorkspaceMetadata,
        pending: &Option<(u64, String)>,
    ) -> Result<Arc<Workspace>> {
        let ws = self.cold_resume(meta).await?;
        if let Some((turn_index, _)) = pending {
            self.inner
                .store
                .append_action(
                    &meta.id,
                    &StoreAction::TurnRollback {
                        turn_index: *turn_index,
                        rolled_back_to: meta.head_commit.clone(),
                    },
                )
                .await?;
        }
        Ok(ws)
    }

    /// Graceful idle-TTL cleanup: snapshot working tree → stash dirty files →
    /// persist metadata + stash bundle to Store → wipe disk → mark Removed.
    ///
    /// Caller must own the workspace (it must be in Attached or Idle state) —
    /// the routine drives state through Cleaning → Removed.
    ///
    /// Phase 3 (CIR-31): if the workspace has an in-flight turn, cleanup is
    /// rejected immediately with `Error::TurnInFlight`. Mid-turn evicts are
    /// forbidden — the caller must wait for the turn to commit or abort.
    pub async fn cleanup(&self, ws: &Arc<Workspace>) -> Result<()> {
        if ws.active_turn().await.is_some() {
            return Err(Error::TurnInFlight(ws.id.0.clone()));
        }
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

    pub async fn register(&self, ws: Arc<Workspace>) {
        self.inner.registry.lock().await.insert(ws.id.clone(), ws);
    }

    pub async fn unregister(&self, id: &WorkspaceId) -> Option<Arc<Workspace>> {
        self.inner.registry.lock().await.remove(id)
    }
}

enum Either {
    Reuse(Arc<Workspace>),
    Create(u32),
}

enum DiskState {
    Missing,
    HeadMatch,
    HeadDiverged { live_head: String },
    HeadUnreadable,
}

/// Walk the action log and return `Some((turn_index, base_head))` if the most
/// recent `TurnBegin` has no matching `TurnComplete` or `TurnRollback`. Used
/// by `recover` to detect and undo a turn that crashed mid-execution.
fn pending_turn_from_log(actions: &[StoreAction]) -> Option<(u64, String)> {
    let mut pending: Option<(u64, String)> = None;
    for a in actions {
        match a {
            StoreAction::TurnBegin {
                turn_index,
                base_head,
            } => {
                pending = Some((*turn_index, base_head.clone()));
            }
            StoreAction::TurnComplete { turn_index, .. }
            | StoreAction::TurnRollback { turn_index, .. } => {
                if matches!(pending.as_ref(), Some((idx, _)) if *idx == *turn_index) {
                    pending = None;
                }
            }
            _ => {}
        }
    }
    pending
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
    async fn abort_cancels_token_and_metadata_holds_last_turn() {
        use crate::workspace::metadata::TurnBoundary;
        let (_src, _ws_root, mgr, url) = fixture().await;
        let ws = mgr.acquire("alice", &url).await.unwrap();
        let last = TurnBoundary::now(2);
        ws.record_turn(last).await;
        // Mid-turn 3 starts but never completes — abort fires.
        let token = ws.cancel_token();
        ws.abort().await.unwrap();
        assert_eq!(ws.state().await, WorkspaceState::Aborting);
        assert!(token.is_cancelled());
        // After release, state returns to Idle, last_turn still points to the
        // last completed boundary (turn 2), not the aborted in-flight one.
        ws.release().await.unwrap();
        assert_eq!(ws.state().await, WorkspaceState::Idle);
        let m = ws.metadata_snapshot().await;
        assert_eq!(m.last_turn.unwrap().turn_index, 2);
    }

    #[tokio::test]
    async fn abort_when_idle_is_invalid_state() {
        let (_src, _ws_root, mgr, url) = fixture().await;
        let ws = mgr.acquire("alice", &url).await.unwrap();
        ws.release().await.unwrap();
        let result = ws.abort().await;
        assert!(matches!(result, Err(Error::InvalidState { .. })));
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
    async fn recover_from_clean_disk_reuses_existing_workspace() {
        let (_src, _ws_root, mgr, url) = fixture().await;
        let ws = mgr.acquire("alice", &url).await.unwrap();
        let id = ws.id.clone();
        let path = ws.path.clone();
        let head = ws.metadata_snapshot().await.head_commit.clone();
        // Persist metadata so recover can find it.
        mgr.store()
            .write_metadata(&ws.metadata_snapshot().await)
            .await
            .unwrap();
        // Simulate crash: drop in-memory workspace, but leave disk + metadata intact.
        ws.release().await.unwrap();
        mgr.unregister(&id).await;

        let recovered = mgr.recover(&id).await.unwrap();
        assert_eq!(recovered.id, id);
        assert_eq!(recovered.path, path);
        assert_eq!(recovered.metadata_snapshot().await.head_commit, head);
        assert_eq!(recovered.state().await, WorkspaceState::Idle);
    }

    #[tokio::test]
    async fn recover_from_missing_disk_falls_back_to_cold_resume() {
        let (_src, _ws_root, mgr, url) = fixture().await;
        let ws = mgr.acquire("alice", &url).await.unwrap();
        let id = ws.id.clone();
        let path = ws.path.clone();
        // Take a snapshot, save stash with dirty file, then run cleanup so disk is wiped.
        tokio::fs::write(path.join("scratch.txt"), b"WIP\n")
            .await
            .unwrap();
        ws.release().await.unwrap();
        mgr.cleanup(&ws).await.unwrap();
        assert!(!path.exists());

        let recovered = mgr.recover(&id).await.unwrap();
        assert!(recovered.path.exists());
        assert_eq!(recovered.id, id);
        // Stash applied → scratch.txt restored.
        let restored = tokio::fs::read(recovered.path.join("scratch.txt"))
            .await
            .unwrap();
        assert_eq!(restored, b"WIP\n");
    }

    #[tokio::test]
    async fn cold_resume_restores_dirty_state_from_metadata_only() {
        let (_src, _ws_root, mgr, url) = fixture().await;
        let ws = mgr.acquire("alice", &url).await.unwrap();
        tokio::fs::write(ws.path.join("dirty.txt"), b"WIP\n")
            .await
            .unwrap();
        ws.release().await.unwrap();
        mgr.cleanup(&ws).await.unwrap();
        // Read the persisted metadata back out — that's the only input cold_resume needs.
        let meta = mgr.store().read_metadata(&ws.id).await.unwrap().unwrap();
        let resumed = mgr.cold_resume(&meta).await.unwrap();
        assert!(resumed.path.exists());
        let restored = tokio::fs::read(resumed.path.join("dirty.txt"))
            .await
            .unwrap();
        assert_eq!(restored, b"WIP\n");
        // ColdResume action must have been appended to the log.
        let actions = mgr.store().read_actions(&ws.id).await.unwrap();
        assert!(
            actions
                .iter()
                .any(|a| matches!(a, StoreAction::ColdResume { .. })),
            "expected ColdResume action in {actions:?}",
        );
    }

    #[tokio::test]
    async fn cold_resume_without_stash_just_reclones_at_head() {
        let (_src, _ws_root, mgr, url) = fixture().await;
        let ws = mgr.acquire("alice", &url).await.unwrap();
        let head = ws.metadata_snapshot().await.head_commit.clone();
        ws.release().await.unwrap();
        mgr.cleanup(&ws).await.unwrap();
        let meta = mgr.store().read_metadata(&ws.id).await.unwrap().unwrap();
        assert!(meta.stash_ref.is_none());
        let resumed = mgr.cold_resume(&meta).await.unwrap();
        let resumed_head = resumed.metadata_snapshot().await.head_commit;
        assert_eq!(resumed_head, head);
        assert!(resumed.path.join("README.md").exists());
    }

    #[tokio::test]
    async fn recover_unknown_id_returns_not_found() {
        let (_src, _ws_root, mgr, _url) = fixture().await;
        let result = mgr.recover(&WorkspaceId::new("ghost", "nope", 0)).await;
        assert!(matches!(result, Err(Error::NotFound(_))));
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

    #[tokio::test]
    async fn begin_turn_records_turnbegin_with_current_head() {
        let (_src, _ws_root, mgr, url) = fixture().await;
        let ws = mgr.acquire("alice", &url).await.unwrap();
        mgr.begin_turn(&ws, 1).await.unwrap();

        let active = ws.active_turn().await.expect("active turn");
        assert_eq!(active.turn_index, 1);
        let head = ws.metadata_snapshot().await.head_commit;
        assert_eq!(active.base_head, head);

        let actions = mgr.store().read_actions(&ws.id).await.unwrap();
        let begin = actions
            .iter()
            .filter_map(|a| match a {
                StoreAction::TurnBegin {
                    turn_index,
                    base_head,
                } => Some((*turn_index, base_head.clone())),
                _ => None,
            })
            .last()
            .expect("TurnBegin in log");
        assert_eq!(begin.0, 1);
        assert_eq!(begin.1, head);
    }

    #[tokio::test]
    async fn commit_turn_clears_active_persists_metadata_and_logs_complete() {
        let (_src, _ws_root, mgr, url) = fixture().await;
        let ws = mgr.acquire("alice", &url).await.unwrap();
        mgr.begin_turn(&ws, 5).await.unwrap();
        tokio::fs::write(ws.path.join("scratch.txt"), b"hi\n")
            .await
            .unwrap();

        mgr.commit_turn(&ws).await.unwrap();
        assert!(ws.active_turn().await.is_none());

        // last_turn must be persisted to the Store, not just in memory.
        let stored = mgr.store().read_metadata(&ws.id).await.unwrap().unwrap();
        assert_eq!(stored.last_turn.unwrap().turn_index, 5);

        let actions = mgr.store().read_actions(&ws.id).await.unwrap();
        let complete = actions
            .iter()
            .filter_map(|a| match a {
                StoreAction::TurnComplete {
                    turn_index,
                    dirty_files,
                    ..
                } => Some((*turn_index, dirty_files.clone())),
                _ => None,
            })
            .last()
            .expect("TurnComplete in log");
        assert_eq!(complete.0, 5);
        let names: Vec<String> = complete
            .1
            .iter()
            .map(|p| p.to_string_lossy().into_owned())
            .collect();
        assert!(names.iter().any(|n| n == "scratch.txt"));
    }

    #[tokio::test]
    async fn commit_turn_without_begin_errors() {
        let (_src, _ws_root, mgr, url) = fixture().await;
        let ws = mgr.acquire("alice", &url).await.unwrap();
        let result = mgr.commit_turn(&ws).await;
        assert!(matches!(result, Err(Error::Other(_))));
    }

    #[test]
    fn pending_turn_from_log_finds_unmatched_begin() {
        let actions = vec![
            StoreAction::Acquire {
                head_commit: "h0".into(),
                branch: Some("main".into()),
            },
            StoreAction::TurnBegin {
                turn_index: 1,
                base_head: "h0".into(),
            },
            StoreAction::TurnComplete {
                turn_index: 1,
                head_commit: "h1".into(),
                dirty_files: vec![],
            },
            StoreAction::TurnBegin {
                turn_index: 2,
                base_head: "h1".into(),
            },
        ];
        let pending = pending_turn_from_log(&actions);
        assert_eq!(pending, Some((2, "h1".to_string())));
    }

    #[test]
    fn pending_turn_from_log_clears_on_rollback() {
        let actions = vec![
            StoreAction::TurnBegin {
                turn_index: 5,
                base_head: "h5".into(),
            },
            StoreAction::TurnRollback {
                turn_index: 5,
                rolled_back_to: "h5".into(),
            },
        ];
        assert!(pending_turn_from_log(&actions).is_none());
    }

    #[tokio::test]
    async fn recover_rolls_back_uncommitted_turn_when_disk_intact() {
        let (_src, _ws_root, mgr, url) = fixture().await;
        let ws = mgr.acquire("alice", &url).await.unwrap();
        let id = ws.id.clone();
        let path = ws.path.clone();
        let head = ws.metadata_snapshot().await.head_commit.clone();

        // Begin a turn, dirty the working tree, and "crash" before commit.
        mgr.begin_turn(&ws, 1).await.unwrap();
        tokio::fs::write(path.join("scratch.txt"), b"WIP\n")
            .await
            .unwrap();
        ws.release().await.unwrap();
        // Drop in-memory state but leave disk + Store + action log intact.
        drop(ws);
        mgr.unregister(&id).await;

        let recovered = mgr.recover(&id).await.unwrap();
        // Rollback target == base_head (the HEAD captured at begin_turn).
        assert_eq!(recovered.metadata_snapshot().await.head_commit, head);
        assert!(!recovered.path.join("scratch.txt").exists());
        assert!(recovered.active_turn().await.is_none());

        // Action log self-describes the rollback. Phase 4 (CIR-32) appends
        // a `Reconcile` entry after the rollback, so the rollback is the
        // second-to-last action.
        let actions = mgr.store().read_actions(&id).await.unwrap();
        assert!(actions.iter().any(|a| matches!(
            a,
            StoreAction::TurnRollback { turn_index: 1, .. }
        )));
        assert!(matches!(
            actions.last().unwrap(),
            StoreAction::Reconcile { .. }
        ));
    }

    #[tokio::test]
    async fn recover_logs_rollback_when_disk_lost() {
        let (_src, _ws_root, mgr, url) = fixture().await;
        let ws = mgr.acquire("alice", &url).await.unwrap();
        let id = ws.id.clone();
        let head = ws.metadata_snapshot().await.head_commit.clone();

        // Begin a turn, drop a dirty file, then run cleanup so disk is wiped
        // while the action log keeps the unmatched TurnBegin around.
        mgr.begin_turn(&ws, 9).await.unwrap();
        tokio::fs::write(ws.path.join("dirty.txt"), b"WIP\n")
            .await
            .unwrap();
        // cleanup would refuse mid-turn — abort the turn first to simulate the
        // checkpoint-evictable "in-flight begin then turn aborted before commit"
        // shape that the action log produces during a real crash.
        ws.abort_turn().await;
        ws.release().await.unwrap();
        mgr.cleanup(&ws).await.unwrap();
        assert!(!ws.path.exists());

        // Forge a stray TurnBegin in the log so recover sees a pending turn
        // that points at the just-cleaned head — exactly the state a crash
        // between begin_turn and commit_turn produces (the begin already wrote
        // to the log, but no commit/rollback ever followed).
        mgr.store()
            .append_action(
                &id,
                &StoreAction::TurnBegin {
                    turn_index: 42,
                    base_head: head.clone(),
                },
            )
            .await
            .unwrap();

        let recovered = mgr.recover(&id).await.unwrap();
        assert!(recovered.path.exists());
        // Cold resume restored the dirty file from stash; rollback only logs.
        assert!(recovered.path.join("dirty.txt").exists());

        let actions = mgr.store().read_actions(&id).await.unwrap();
        let rollback = actions.iter().rev().find_map(|a| match a {
            StoreAction::TurnRollback {
                turn_index,
                rolled_back_to,
            } => Some((*turn_index, rolled_back_to.clone())),
            _ => None,
        });
        assert_eq!(rollback, Some((42, head)));
    }

    #[tokio::test]
    async fn cleanup_rejects_in_flight_workspace() {
        let (_src, _ws_root, mgr, url) = fixture().await;
        let ws = mgr.acquire("alice", &url).await.unwrap();
        mgr.begin_turn(&ws, 1).await.unwrap();
        ws.release().await.unwrap(); // Idle but turn still in flight.

        let result = mgr.cleanup(&ws).await;
        assert!(matches!(result, Err(Error::TurnInFlight(_))));
        // Workspace must remain on disk and registered.
        assert!(ws.path.exists());
        assert!(mgr.lookup(&ws.id).await.is_some());

        // After commit_turn, cleanup proceeds normally.
        ws.attach().await.unwrap();
        mgr.commit_turn(&ws).await.unwrap();
        ws.release().await.unwrap();
        mgr.cleanup(&ws).await.unwrap();
        assert!(!ws.path.exists());
    }

    // ---------- Phase 4 (CIR-32) reconcile unit coverage ----------

    /// Helper: run a single git command in `path` and return stdout. Used by
    /// the reconcile divergence tests to simulate "user did `git commit`" or
    /// "external push moved HEAD" without going through the full lifecycle.
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

    #[tokio::test]
    async fn reconcile_head_match_is_a_no_op() {
        let (_src, _ws_root, mgr, url) = fixture().await;
        let ws = mgr.acquire("alice", &url).await.unwrap();
        let id = ws.id.clone();
        let head = ws.metadata_snapshot().await.head_commit.clone();
        mgr.store()
            .write_metadata(&ws.metadata_snapshot().await)
            .await
            .unwrap();
        ws.release().await.unwrap();
        mgr.unregister(&id).await;

        let (recovered, outcome) = mgr.reconcile(&id).await.unwrap();
        assert_eq!(outcome, ReconcileOutcome::HeadMatch);
        assert_eq!(recovered.metadata_snapshot().await.head_commit, head);

        // Action log must contain a Reconcile entry tagged HeadMatch.
        let actions = mgr.store().read_actions(&id).await.unwrap();
        let reconcile = actions.iter().rev().find_map(|a| match a {
            StoreAction::Reconcile {
                strategy,
                after_head,
                ..
            } => Some((strategy.clone(), after_head.clone())),
            _ => None,
        });
        assert_eq!(reconcile, Some((ReconcileStrategy::HeadMatch, head)));
    }

    #[tokio::test]
    async fn reconcile_diverged_head_replays_to_store_head() {
        let (_src, _ws_root, mgr, url) = fixture().await;
        let ws = mgr.acquire("alice", &url).await.unwrap();
        let id = ws.id.clone();
        let path = ws.path.clone();
        let store_head = ws.metadata_snapshot().await.head_commit.clone();
        mgr.store()
            .write_metadata(&ws.metadata_snapshot().await)
            .await
            .unwrap();
        ws.release().await.unwrap();
        mgr.unregister(&id).await;

        // Simulate external push / user commit: drop a new commit on top of
        // HEAD without going through begin_turn / commit_turn, so Store's
        // recorded head_commit no longer matches the disk's HEAD.
        tokio::fs::write(path.join("rogue.txt"), b"rogue\n")
            .await
            .unwrap();
        run_git(&path, &["add", "-A"]).await;
        run_git(
            &path,
            &[
                "-c",
                "user.email=rogue@cir32.local",
                "-c",
                "user.name=rogue",
                "-c",
                "commit.gpgsign=false",
                "commit",
                "-m",
                "external",
            ],
        )
        .await;
        let diverged_head = run_git(&path, &["rev-parse", "HEAD"]).await.trim().to_owned();
        assert_ne!(diverged_head, store_head);

        let (recovered, outcome) = mgr.reconcile(&id).await.unwrap();
        match &outcome {
            ReconcileOutcome::Replay { from, to } => {
                assert_eq!(from, &diverged_head);
                assert_eq!(to, &store_head);
            }
            other => panic!("expected Replay, got {other:?}"),
        }
        // Disk HEAD restored to Store's recorded head_commit; rogue file gone.
        let live_head = git_ops::head_commit(&recovered.path).await.unwrap();
        assert_eq!(live_head, store_head);
        assert!(!recovered.path.join("rogue.txt").exists());
    }

    #[tokio::test]
    async fn reconcile_missing_disk_cold_resumes() {
        let (_src, _ws_root, mgr, url) = fixture().await;
        let ws = mgr.acquire("alice", &url).await.unwrap();
        let id = ws.id.clone();
        let path = ws.path.clone();
        ws.release().await.unwrap();
        mgr.cleanup(&ws).await.unwrap();
        assert!(!path.exists());

        let (recovered, outcome) = mgr.reconcile(&id).await.unwrap();
        assert_eq!(
            outcome,
            ReconcileOutcome::ColdResume {
                reason: ColdResumeReason::MissingDisk,
            }
        );
        assert!(recovered.path.exists());
    }

    #[tokio::test]
    async fn reconcile_unreadable_head_cold_resumes() {
        let (_src, _ws_root, mgr, url) = fixture().await;
        let ws = mgr.acquire("alice", &url).await.unwrap();
        let id = ws.id.clone();
        let path = ws.path.clone();
        ws.release().await.unwrap();
        mgr.unregister(&id).await;

        // Corrupt the .git directory by removing HEAD so rev-parse errors.
        tokio::fs::remove_dir_all(path.join(".git")).await.unwrap();
        // Leave path on disk so classify_disk picks HeadUnreadable, not Missing.
        assert!(path.exists());

        let (_recovered, outcome) = mgr.reconcile(&id).await.unwrap();
        assert_eq!(
            outcome,
            ReconcileOutcome::ColdResume {
                reason: ColdResumeReason::HeadUnreadable,
            }
        );
    }

    #[tokio::test]
    async fn reconcile_pending_turn_with_diverged_head_rolls_back_via_replay() {
        let (_src, _ws_root, mgr, url) = fixture().await;
        let ws = mgr.acquire("alice", &url).await.unwrap();
        let id = ws.id.clone();
        let path = ws.path.clone();
        let base_head = ws.metadata_snapshot().await.head_commit.clone();

        // Begin a turn, advance HEAD with a real commit, persist that head
        // to Store's metadata to mimic a real settled-then-reopened turn,
        // then "crash" with a stray TurnBegin still in the action log.
        mgr.begin_turn(&ws, 1).await.unwrap();
        tokio::fs::write(path.join("scratch.txt"), b"WIP\n")
            .await
            .unwrap();
        // Move disk HEAD past base_head with a rogue external commit so
        // reconcile sees BOTH a pending turn AND a diverged HEAD.
        run_git(&path, &["add", "-A"]).await;
        run_git(
            &path,
            &[
                "-c",
                "user.email=rogue@cir32.local",
                "-c",
                "user.name=rogue",
                "-c",
                "commit.gpgsign=false",
                "commit",
                "-m",
                "rogue",
            ],
        )
        .await;
        ws.release().await.unwrap();
        drop(ws);
        mgr.unregister(&id).await;

        let (recovered, outcome) = mgr.reconcile(&id).await.unwrap();
        assert!(matches!(outcome, ReconcileOutcome::Replay { .. }));
        // Replay target is the pending turn's base_head, which equals Store's
        // recorded head_commit at this point.
        assert_eq!(recovered.metadata_snapshot().await.head_commit, base_head);
        assert!(!recovered.path.join("scratch.txt").exists());

        let actions = mgr.store().read_actions(&id).await.unwrap();
        assert!(actions.iter().any(|a| matches!(
            a,
            StoreAction::TurnRollback { turn_index: 1, .. }
        )));
        assert!(matches!(
            actions.last().unwrap(),
            StoreAction::Reconcile { strategy: ReconcileStrategy::Replay, .. }
        ));
    }
}
