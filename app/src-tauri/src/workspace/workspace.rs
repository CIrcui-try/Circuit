use crate::workspace::errors::{Error, Result};
use crate::workspace::metadata::{TurnBoundary, WorkspaceId, WorkspaceMetadata};
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::{Mutex, RwLock};
use tokio_util::sync::CancellationToken;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WorkspaceState {
    Idle,
    Attached,
    Aborting,
    Cleaning,
    Removed,
}

impl WorkspaceState {
    fn label(self) -> &'static str {
        match self {
            WorkspaceState::Idle => "Idle",
            WorkspaceState::Attached => "Attached",
            WorkspaceState::Aborting => "Aborting",
            WorkspaceState::Cleaning => "Cleaning",
            WorkspaceState::Removed => "Removed",
        }
    }
}

#[derive(Debug)]
pub struct Workspace {
    pub id: WorkspaceId,
    pub path: PathBuf,
    state: Mutex<WorkspaceState>,
    pub(crate) metadata: RwLock<WorkspaceMetadata>,
    pub(crate) cancel: CancellationToken,
}

impl Workspace {
    pub(crate) fn new(id: WorkspaceId, path: PathBuf, metadata: WorkspaceMetadata) -> Arc<Self> {
        Arc::new(Self {
            id,
            path,
            state: Mutex::new(WorkspaceState::Idle),
            metadata: RwLock::new(metadata),
            cancel: CancellationToken::new(),
        })
    }

    pub async fn state(&self) -> WorkspaceState {
        *self.state.lock().await
    }

    /// Try to claim the workspace as the active session. Returns
    /// `Error::AlreadyAttached` if another caller already holds it.
    pub async fn attach(&self) -> Result<()> {
        let mut g = self.state.lock().await;
        match *g {
            WorkspaceState::Idle => {
                *g = WorkspaceState::Attached;
                Ok(())
            }
            WorkspaceState::Attached => Err(Error::AlreadyAttached(self.id.0.clone())),
            other => Err(Error::InvalidState {
                expected: "Idle".into(),
                actual: other.label().into(),
            }),
        }
    }

    pub async fn release(&self) -> Result<()> {
        let mut g = self.state.lock().await;
        match *g {
            WorkspaceState::Attached | WorkspaceState::Aborting => {
                *g = WorkspaceState::Idle;
                Ok(())
            }
            other => Err(Error::InvalidState {
                expected: "Attached|Aborting".into(),
                actual: other.label().into(),
            }),
        }
    }

    pub async fn metadata_snapshot(&self) -> WorkspaceMetadata {
        self.metadata.read().await.clone()
    }

    pub async fn record_turn(&self, boundary: TurnBoundary) {
        let mut m = self.metadata.write().await;
        m.last_turn = Some(boundary);
    }

    /// Signal callers (tool calls, sub-agents) to stop. Marks the workspace as
    /// `Aborting`; `release()` afterwards resets it to `Idle`. The persisted
    /// metadata's `last_turn` already points at the latest completed turn —
    /// that is the "settle to last completed turn" guarantee from CIR-30.
    pub async fn abort(&self) -> Result<()> {
        {
            let mut g = self.state.lock().await;
            match *g {
                WorkspaceState::Attached => {
                    *g = WorkspaceState::Aborting;
                }
                WorkspaceState::Aborting => return Ok(()),
                other => {
                    return Err(Error::InvalidState {
                        expected: "Attached".into(),
                        actual: other.label().into(),
                    });
                }
            }
        }
        self.cancel.cancel();
        Ok(())
    }

    pub fn is_cancelled(&self) -> bool {
        self.cancel.is_cancelled()
    }

    pub(crate) async fn set_state(&self, target: WorkspaceState) {
        *self.state.lock().await = target;
    }

    pub(crate) async fn state_mut(&self) -> tokio::sync::MutexGuard<'_, WorkspaceState> {
        self.state.lock().await
    }

    pub fn cancel_token(&self) -> CancellationToken {
        self.cancel.clone()
    }
}
