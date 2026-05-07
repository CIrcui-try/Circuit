//! Workspace lifecycle (CIR-30, Phase 2).
//!
//! Source of truth: `Coding Agent 세션 관리 / Cold Start` 설계 문서 v2 §2.

pub mod errors;
pub mod git_ops;
pub mod manager;
pub mod metadata;
pub mod store;
pub mod ttl;
pub mod workspace;

pub use errors::{Error, Result};
pub use manager::WorkspaceManager;
pub use metadata::{TurnBoundary, WorkspaceId, WorkspaceMetadata};
pub use store::{StoreAction, WorkspaceStore};
pub use workspace::{InFlightTurn, Workspace, WorkspaceState};
