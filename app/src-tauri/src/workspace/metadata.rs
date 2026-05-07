use serde::{Deserialize, Serialize};
use std::path::PathBuf;
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
}
