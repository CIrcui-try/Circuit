//! `WorkspaceManager` — populated in later commits within CIR-30.
use crate::workspace::store::WorkspaceStore;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

#[derive(Debug, Clone)]
pub struct WorkspaceManager {
    pub(crate) root: PathBuf,
    pub(crate) store: Arc<WorkspaceStore>,
    pub(crate) idle_ttl: Duration,
}

impl WorkspaceManager {
    pub fn root(&self) -> &PathBuf {
        &self.root
    }
    pub fn store(&self) -> &WorkspaceStore {
        &self.store
    }
    pub fn idle_ttl(&self) -> Duration {
        self.idle_ttl
    }
}
