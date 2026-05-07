//! `Workspace` runtime — populated in later commits within CIR-30.
use crate::workspace::metadata::WorkspaceId;
use std::path::PathBuf;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WorkspaceState {
    Idle,
    Attached,
    Aborting,
    Cleaning,
    Removed,
}

#[derive(Debug)]
pub struct Workspace {
    pub id: WorkspaceId,
    pub path: PathBuf,
    pub(crate) inner: tokio::sync::Mutex<Inner>,
}

#[derive(Debug, Default)]
pub(crate) struct Inner {
    pub(crate) state: WorkspaceState,
    pub(crate) attached: bool,
}

impl Default for WorkspaceState {
    fn default() -> Self {
        WorkspaceState::Idle
    }
}
