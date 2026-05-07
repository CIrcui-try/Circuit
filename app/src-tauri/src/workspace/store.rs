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
