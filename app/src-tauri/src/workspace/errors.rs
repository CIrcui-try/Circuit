use std::path::PathBuf;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum Error {
    #[error("workspace already attached: {0}")]
    AlreadyAttached(String),
    #[error("workspace not found: {0}")]
    NotFound(String),
    #[error("workspace state invalid: expected {expected}, got {actual}")]
    InvalidState { expected: String, actual: String },
    #[error("path escape: {0:?} is outside workspace root")]
    PathEscape(PathBuf),
    #[error("git command failed ({code}): {stderr}")]
    Git { code: i32, stderr: String },
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("serde: {0}")]
    Serde(#[from] serde_json::Error),
    #[error("aborted")]
    Aborted,
    #[error("other: {0}")]
    Other(String),
}

pub type Result<T> = std::result::Result<T, Error>;
