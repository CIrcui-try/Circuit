use crate::workspace::errors::{Error, Result};
use crate::workspace::metadata::{WorkspaceId, WorkspaceMetadata};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tokio::fs;
use tokio::io::AsyncWriteExt;

/// Append-only action log entry. Phase 2 keeps this minimal — later phases
/// extend it with tool-call payloads, turn boundaries, etc.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum StoreAction {
    Acquire {
        head_commit: String,
        branch: Option<String>,
    },
    TurnComplete {
        turn_index: u64,
        head_commit: String,
        dirty_files: Vec<PathBuf>,
    },
    Stash {
        stash_sha: String,
        dirty_files: Vec<PathBuf>,
    },
    Cleanup,
    ColdResume {
        head_commit: String,
        stash_applied: Option<String>,
    },
}

#[derive(Debug, Clone)]
pub struct WorkspaceStore {
    root: PathBuf,
}

impl WorkspaceStore {
    pub async fn open(root: impl Into<PathBuf>) -> Result<Self> {
        let root = root.into();
        fs::create_dir_all(root.join("metadata")).await?;
        fs::create_dir_all(root.join("actions")).await?;
        fs::create_dir_all(root.join("stashes")).await?;
        Ok(Self { root })
    }

    pub fn metadata_path(&self, id: &WorkspaceId) -> PathBuf {
        self.root.join("metadata").join(format!("{}.json", id.0))
    }

    pub fn actions_path(&self, id: &WorkspaceId) -> PathBuf {
        self.root.join("actions").join(format!("{}.jsonl", id.0))
    }

    pub fn stash_dir(&self, id: &WorkspaceId) -> PathBuf {
        self.root.join("stashes").join(&id.0)
    }

    pub async fn write_metadata(&self, meta: &WorkspaceMetadata) -> Result<()> {
        let path = self.metadata_path(&meta.id);
        let json = serde_json::to_vec_pretty(meta)?;
        write_atomic(&path, &json).await
    }

    pub async fn read_metadata(&self, id: &WorkspaceId) -> Result<Option<WorkspaceMetadata>> {
        let path = self.metadata_path(id);
        match fs::read(&path).await {
            Ok(bytes) => Ok(Some(serde_json::from_slice(&bytes)?)),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(Error::Io(e)),
        }
    }

    pub async fn append_action(&self, id: &WorkspaceId, action: &StoreAction) -> Result<()> {
        let path = self.actions_path(id);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).await?;
        }
        let mut line = serde_json::to_vec(action)?;
        line.push(b'\n');
        let mut f = fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)
            .await?;
        f.write_all(&line).await?;
        f.flush().await?;
        Ok(())
    }

    pub async fn read_actions(&self, id: &WorkspaceId) -> Result<Vec<StoreAction>> {
        let path = self.actions_path(id);
        let bytes = match fs::read(&path).await {
            Ok(b) => b,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(e) => return Err(Error::Io(e)),
        };
        let mut out = Vec::new();
        for line in bytes.split(|b| *b == b'\n') {
            if line.is_empty() {
                continue;
            }
            out.push(serde_json::from_slice(line)?);
        }
        Ok(out)
    }

    pub async fn save_stash_blob(
        &self,
        id: &WorkspaceId,
        sha: &str,
        bytes: &[u8],
    ) -> Result<PathBuf> {
        let dir = self.stash_dir(id);
        fs::create_dir_all(&dir).await?;
        let path = dir.join(sha);
        write_atomic(&path, bytes).await?;
        Ok(path)
    }

    pub async fn load_stash_blob(&self, id: &WorkspaceId, sha: &str) -> Result<Option<Vec<u8>>> {
        let path = self.stash_dir(id).join(sha);
        match fs::read(&path).await {
            Ok(b) => Ok(Some(b)),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(Error::Io(e)),
        }
    }

    pub async fn delete_workspace_artifacts(&self, id: &WorkspaceId) -> Result<()> {
        // Remove metadata file but keep action log + stash blobs (cold resume needs them).
        let mp = self.metadata_path(id);
        match fs::remove_file(&mp).await {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(Error::Io(e)),
        }
    }
}

async fn write_atomic(path: &Path, bytes: &[u8]) -> Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).await?;
    }
    let tmp = path.with_extension("tmp");
    fs::write(&tmp, bytes).await?;
    fs::rename(&tmp, path).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workspace::metadata::{WorkspaceId, WorkspaceMetadata};
    use tempfile::TempDir;

    #[tokio::test]
    async fn metadata_roundtrip() {
        let tmp = TempDir::new().unwrap();
        let store = WorkspaceStore::open(tmp.path()).await.unwrap();
        let id = WorkspaceId::new("alice", "repo", 0);
        let meta = WorkspaceMetadata {
            id: id.clone(),
            repo_url: "file:///dummy".into(),
            user_id: "alice".into(),
            head_commit: "deadbeef".into(),
            branch: Some("main".into()),
            dirty_files: vec![PathBuf::from("a.txt")],
            stash_ref: Some("cafebabe".into()),
            last_turn: None,
        };
        store.write_metadata(&meta).await.unwrap();
        let loaded = store.read_metadata(&id).await.unwrap().unwrap();
        assert_eq!(loaded.head_commit, "deadbeef");
        assert_eq!(loaded.dirty_files, vec![PathBuf::from("a.txt")]);
        assert_eq!(loaded.stash_ref.as_deref(), Some("cafebabe"));
    }

    #[tokio::test]
    async fn action_log_append_and_replay() {
        let tmp = TempDir::new().unwrap();
        let store = WorkspaceStore::open(tmp.path()).await.unwrap();
        let id = WorkspaceId::new("alice", "repo", 0);
        store
            .append_action(
                &id,
                &StoreAction::Acquire {
                    head_commit: "abc".into(),
                    branch: Some("main".into()),
                },
            )
            .await
            .unwrap();
        store
            .append_action(
                &id,
                &StoreAction::TurnComplete {
                    turn_index: 1,
                    head_commit: "abc".into(),
                    dirty_files: vec![PathBuf::from("x.txt")],
                },
            )
            .await
            .unwrap();
        let actions = store.read_actions(&id).await.unwrap();
        assert_eq!(actions.len(), 2);
        match &actions[1] {
            StoreAction::TurnComplete { turn_index, .. } => assert_eq!(*turn_index, 1),
            other => panic!("unexpected: {other:?}"),
        }
    }

    #[tokio::test]
    async fn stash_blob_roundtrip() {
        let tmp = TempDir::new().unwrap();
        let store = WorkspaceStore::open(tmp.path()).await.unwrap();
        let id = WorkspaceId::new("alice", "repo", 0);
        let path = store
            .save_stash_blob(&id, "sha1", b"bundle-bytes")
            .await
            .unwrap();
        assert!(path.exists());
        let loaded = store.load_stash_blob(&id, "sha1").await.unwrap();
        assert_eq!(loaded.as_deref(), Some(&b"bundle-bytes"[..]));
        let missing = store.load_stash_blob(&id, "nope").await.unwrap();
        assert!(missing.is_none());
    }

    #[tokio::test]
    async fn delete_metadata_keeps_action_log() {
        let tmp = TempDir::new().unwrap();
        let store = WorkspaceStore::open(tmp.path()).await.unwrap();
        let id = WorkspaceId::new("alice", "repo", 0);
        let meta = WorkspaceMetadata::empty(id.clone(), "alice".into(), "file:///x".into());
        store.write_metadata(&meta).await.unwrap();
        store
            .append_action(&id, &StoreAction::Cleanup)
            .await
            .unwrap();
        store.delete_workspace_artifacts(&id).await.unwrap();
        assert!(store.read_metadata(&id).await.unwrap().is_none());
        let actions = store.read_actions(&id).await.unwrap();
        assert_eq!(actions.len(), 1);
    }
}
