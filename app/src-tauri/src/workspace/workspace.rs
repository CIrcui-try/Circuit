use crate::workspace::errors::{Error, Result};
use crate::workspace::metadata::{TurnBoundary, WorkspaceId, WorkspaceMetadata};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::sync::{Mutex, RwLock};
use tokio_util::sync::CancellationToken;

/// In-memory record of a turn that has started but not yet committed.
/// `base_head` is the HEAD commit captured the moment the turn began —
/// crash recovery uses it to roll the working tree back to that commit
/// when a TurnBegin in the action log lacks a matching TurnComplete.
#[derive(Debug, Clone)]
pub struct InFlightTurn {
    pub turn_index: u64,
    pub base_head: String,
    pub started_at_unix_ms: u128,
}

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
    pub(crate) active_turn: RwLock<Option<InFlightTurn>>,
}

impl Workspace {
    pub(crate) fn new(id: WorkspaceId, path: PathBuf, metadata: WorkspaceMetadata) -> Arc<Self> {
        Arc::new(Self {
            id,
            path,
            state: Mutex::new(WorkspaceState::Idle),
            metadata: RwLock::new(metadata),
            cancel: CancellationToken::new(),
            active_turn: RwLock::new(None),
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

    pub async fn active_turn(&self) -> Option<InFlightTurn> {
        self.active_turn.read().await.clone()
    }

    /// Mark the start of a new turn. The workspace must be `Attached` and have
    /// no other turn in flight. `base_head` should be the current HEAD commit
    /// — captured by the caller (typically `WorkspaceManager::begin_turn`) so
    /// crash recovery can `git reset --hard` to it if the turn never commits.
    pub async fn begin_turn(&self, turn_index: u64, base_head: String) -> Result<InFlightTurn> {
        {
            let state = self.state.lock().await;
            if *state != WorkspaceState::Attached {
                return Err(Error::InvalidState {
                    expected: "Attached".into(),
                    actual: state.label().into(),
                });
            }
        }
        let mut g = self.active_turn.write().await;
        if g.is_some() {
            return Err(Error::TurnInFlight(self.id.0.clone()));
        }
        let started_at_unix_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(0, |d| d.as_millis());
        let turn = InFlightTurn {
            turn_index,
            base_head,
            started_at_unix_ms,
        };
        *g = Some(turn.clone());
        Ok(turn)
    }

    /// Settle the in-flight turn: clear it and bump `last_turn`. Returns the
    /// resulting turn boundary so the manager can persist it via the Store.
    pub async fn commit_turn(&self) -> Result<TurnBoundary> {
        let mut g = self.active_turn.write().await;
        let in_flight = g
            .take()
            .ok_or_else(|| Error::Other(format!("no active turn for {}", self.id.0)))?;
        drop(g);
        let boundary = TurnBoundary::now(in_flight.turn_index);
        self.metadata.write().await.last_turn = Some(boundary);
        Ok(boundary)
    }

    /// Discard the in-flight turn without bumping `last_turn`. Used when the
    /// turn cannot complete (e.g. mid-turn cancel that doesn't roll back the
    /// workspace itself, only the active-turn marker).
    pub async fn abort_turn(&self) -> Option<InFlightTurn> {
        self.active_turn.write().await.take()
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workspace::metadata::WorkspaceMetadata;
    use std::path::PathBuf;

    fn make_ws() -> Arc<Workspace> {
        let id = WorkspaceId::new("alice", "repo", 0);
        let meta = WorkspaceMetadata::empty(id.clone(), "alice".into(), "file:///dummy".into());
        Workspace::new(id, PathBuf::from("/tmp/ws"), meta)
    }

    #[tokio::test]
    async fn begin_turn_marks_in_flight_with_base_head() {
        let ws = make_ws();
        ws.attach().await.unwrap();
        let turn = ws.begin_turn(1, "deadbeef".into()).await.unwrap();
        assert_eq!(turn.turn_index, 1);
        assert_eq!(turn.base_head, "deadbeef");
        let active = ws.active_turn().await.unwrap();
        assert_eq!(active.turn_index, 1);
    }

    #[tokio::test]
    async fn begin_turn_when_idle_invalid_state() {
        let ws = make_ws();
        let result = ws.begin_turn(1, "deadbeef".into()).await;
        assert!(matches!(result, Err(Error::InvalidState { .. })));
        assert!(ws.active_turn().await.is_none());
    }

    #[tokio::test]
    async fn begin_turn_twice_rejects_second() {
        let ws = make_ws();
        ws.attach().await.unwrap();
        ws.begin_turn(1, "a".into()).await.unwrap();
        let again = ws.begin_turn(2, "b".into()).await;
        assert!(matches!(again, Err(Error::TurnInFlight(_))));
        // First turn still active.
        assert_eq!(ws.active_turn().await.unwrap().turn_index, 1);
    }

    #[tokio::test]
    async fn commit_turn_clears_in_flight_and_bumps_last_turn() {
        let ws = make_ws();
        ws.attach().await.unwrap();
        ws.begin_turn(7, "abc".into()).await.unwrap();
        let boundary = ws.commit_turn().await.unwrap();
        assert_eq!(boundary.turn_index, 7);
        assert!(ws.active_turn().await.is_none());
        assert_eq!(
            ws.metadata_snapshot().await.last_turn.unwrap().turn_index,
            7
        );
    }

    #[tokio::test]
    async fn commit_turn_without_active_errors() {
        let ws = make_ws();
        ws.attach().await.unwrap();
        let result = ws.commit_turn().await;
        assert!(matches!(result, Err(Error::Other(_))));
    }

    #[tokio::test]
    async fn abort_turn_clears_in_flight_without_updating_last_turn() {
        let ws = make_ws();
        ws.attach().await.unwrap();
        ws.begin_turn(3, "abc".into()).await.unwrap();
        let dropped = ws.abort_turn().await.unwrap();
        assert_eq!(dropped.turn_index, 3);
        assert!(ws.active_turn().await.is_none());
        assert!(ws.metadata_snapshot().await.last_turn.is_none());
    }
}
