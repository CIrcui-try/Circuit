use crate::workspace::errors::Result;
use crate::workspace::git_ops;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct WorkspaceId(pub String);

impl WorkspaceId {
    pub fn new(user: &str, repo_slug: &str, n: u32) -> Self {
        Self(format!("{user}__{repo_slug}__{n}"))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct TurnBoundary {
    pub turn_index: u64,
    pub at_unix_ms: u128,
}

impl TurnBoundary {
    pub fn now(turn_index: u64) -> Self {
        let at_unix_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0);
        Self {
            turn_index,
            at_unix_ms,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkspaceMetadata {
    pub id: WorkspaceId,
    pub repo_url: String,
    pub user_id: String,
    pub head_commit: String,
    pub branch: Option<String>,
    pub dirty_files: Vec<PathBuf>,
    pub stash_ref: Option<String>,
    pub last_turn: Option<TurnBoundary>,
}

impl WorkspaceMetadata {
    pub fn empty(id: WorkspaceId, user_id: String, repo_url: String) -> Self {
        Self {
            id,
            repo_url,
            user_id,
            head_commit: String::new(),
            branch: None,
            dirty_files: Vec::new(),
            stash_ref: None,
            last_turn: None,
        }
    }

    pub fn with_last_turn(mut self, turn: TurnBoundary) -> Self {
        self.last_turn = Some(turn);
        self
    }

    /// Build a metadata snapshot off a working directory's current git state.
    /// Does not mutate the workspace; pure observation.
    pub async fn snapshot(
        id: WorkspaceId,
        user_id: String,
        repo_url: String,
        workspace_path: &Path,
    ) -> Result<Self> {
        let head_commit = git_ops::head_commit(workspace_path).await?;
        let branch = git_ops::current_branch(workspace_path).await?;
        let dirty_files = git_ops::status(workspace_path)
            .await?
            .into_iter()
            .map(|e| e.path)
            .collect();
        Ok(Self {
            id,
            repo_url,
            user_id,
            head_commit,
            branch,
            dirty_files,
            stash_ref: None,
            last_turn: None,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workspace::git_ops::init_repo_with_initial_commit;
    use tempfile::TempDir;
    use tokio::fs;

    #[tokio::test]
    async fn snapshot_clean_repo_records_head_and_branch() {
        let tmp = TempDir::new().unwrap();
        init_repo_with_initial_commit(tmp.path()).await.unwrap();

        let id = WorkspaceId::new("alice", "repo", 0);
        let meta = WorkspaceMetadata::snapshot(
            id.clone(),
            "alice".into(),
            "file:///dummy".into(),
            tmp.path(),
        )
        .await
        .unwrap();

        assert_eq!(meta.id, id);
        assert!(!meta.head_commit.is_empty());
        assert_eq!(meta.branch.as_deref(), Some("main"));
        assert!(meta.dirty_files.is_empty());
        assert!(meta.stash_ref.is_none());
    }

    #[tokio::test]
    async fn snapshot_records_dirty_files() {
        let tmp = TempDir::new().unwrap();
        init_repo_with_initial_commit(tmp.path()).await.unwrap();
        fs::write(tmp.path().join("new.txt"), b"hi\n").await.unwrap();
        fs::write(tmp.path().join("README.md"), b"# changed\n")
            .await
            .unwrap();

        let meta = WorkspaceMetadata::snapshot(
            WorkspaceId::new("alice", "repo", 0),
            "alice".into(),
            "file:///dummy".into(),
            tmp.path(),
        )
        .await
        .unwrap();

        let names: Vec<_> = meta
            .dirty_files
            .iter()
            .map(|p| p.to_string_lossy().into_owned())
            .collect();
        assert!(names.iter().any(|n| n == "new.txt"));
        assert!(names.iter().any(|n| n == "README.md"));
    }
}
