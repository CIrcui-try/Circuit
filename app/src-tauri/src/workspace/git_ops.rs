use crate::workspace::errors::{Error, Result};
use std::path::{Path, PathBuf};
use tokio::process::Command;

async fn run(cwd: Option<&Path>, args: &[&str]) -> Result<String> {
    let mut cmd = Command::new("git");
    if let Some(dir) = cwd {
        cmd.current_dir(dir);
    }
    cmd.args(args);
    let out = cmd.output().await?;
    if !out.status.success() {
        return Err(Error::Git {
            code: out.status.code().unwrap_or(-1),
            stderr: String::from_utf8_lossy(&out.stderr).into_owned(),
        });
    }
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}

pub async fn clone(repo_url: &str, dest: &Path) -> Result<()> {
    if let Some(parent) = dest.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }
    run(
        None,
        &[
            "clone",
            repo_url,
            dest.to_str().ok_or_else(|| Error::Other("dest utf8".into()))?,
        ],
    )
    .await
    .map(|_| ())
}

pub async fn fetch(workspace: &Path) -> Result<()> {
    run(Some(workspace), &["fetch", "--all", "--prune"])
        .await
        .map(|_| ())
}

pub async fn checkout(workspace: &Path, target: &str) -> Result<()> {
    run(Some(workspace), &["checkout", target])
        .await
        .map(|_| ())
}

pub async fn head_commit(workspace: &Path) -> Result<String> {
    let out = run(Some(workspace), &["rev-parse", "HEAD"]).await?;
    Ok(out.trim().to_owned())
}

pub async fn current_branch(workspace: &Path) -> Result<Option<String>> {
    let out = run(Some(workspace), &["symbolic-ref", "--quiet", "--short", "HEAD"]).await;
    match out {
        Ok(s) => {
            let trimmed = s.trim();
            if trimmed.is_empty() {
                Ok(None)
            } else {
                Ok(Some(trimmed.to_owned()))
            }
        }
        Err(Error::Git { code: 1, .. }) => Ok(None), // detached HEAD
        Err(e) => Err(e),
    }
}

#[derive(Debug, Clone)]
pub struct PorcelainEntry {
    pub status: String,
    pub path: PathBuf,
}

pub async fn status(workspace: &Path) -> Result<Vec<PorcelainEntry>> {
    let out = run(Some(workspace), &["status", "--porcelain=v1", "-z"]).await?;
    let mut entries = Vec::new();
    for raw in out.split('\0') {
        if raw.len() < 3 {
            continue;
        }
        let (status, rest) = raw.split_at(2);
        let path = rest.trim_start();
        entries.push(PorcelainEntry {
            status: status.trim().to_owned(),
            path: PathBuf::from(path),
        });
    }
    Ok(entries)
}

/// Stash all changes (including untracked) and return the resulting stash SHA, or
/// `None` when there is nothing to stash.
pub async fn stash_save(workspace: &Path, message: &str) -> Result<Option<String>> {
    // `git stash create` writes a stash commit without touching the stash list.
    // We then `stash store` it so it is referenced and survives until we drop it.
    let sha_out = run(
        Some(workspace),
        &["stash", "create", "--include-untracked", "--", message],
    )
    .await;
    let sha = match sha_out {
        Ok(s) => s.trim().to_owned(),
        // Older git versions don't accept `-- <message>` for `stash create`. Retry without.
        Err(Error::Git { .. }) => {
            let s = run(Some(workspace), &["stash", "create", "--include-untracked"]).await?;
            s.trim().to_owned()
        }
        Err(e) => return Err(e),
    };
    if sha.is_empty() {
        return Ok(None);
    }
    run(
        Some(workspace),
        &["stash", "store", "-m", message, &sha],
    )
    .await?;
    // Reset working tree so cleanup can wipe the directory cleanly.
    run(Some(workspace), &["reset", "--hard", "HEAD"]).await?;
    run(Some(workspace), &["clean", "-fd"]).await?;
    Ok(Some(sha))
}

/// Apply a stash commit (by SHA) to the working tree.
pub async fn stash_apply(workspace: &Path, sha: &str) -> Result<()> {
    run(Some(workspace), &["stash", "apply", sha])
        .await
        .map(|_| ())
}

/// Export a stash commit as a `.bundle` byte blob — used to persist the stash
/// across workspace cleanup so cold resume can restore it.
pub async fn export_stash_bundle(workspace: &Path, sha: &str) -> Result<Vec<u8>> {
    let mut cmd = Command::new("git");
    cmd.current_dir(workspace)
        .args(["bundle", "create", "-", sha]);
    let out = cmd.output().await?;
    if !out.status.success() {
        return Err(Error::Git {
            code: out.status.code().unwrap_or(-1),
            stderr: String::from_utf8_lossy(&out.stderr).into_owned(),
        });
    }
    Ok(out.stdout)
}

/// Import a previously-exported bundle back into the workspace's object DB.
pub async fn import_stash_bundle(workspace: &Path, bundle: &[u8]) -> Result<()> {
    let tmp = workspace.join(".git").join("__cir30_stash.bundle");
    tokio::fs::write(&tmp, bundle).await?;
    let result = run(
        Some(workspace),
        &[
            "bundle",
            "unbundle",
            tmp.to_str().ok_or_else(|| Error::Other("bundle utf8".into()))?,
        ],
    )
    .await
    .map(|_| ());
    let _ = tokio::fs::remove_file(&tmp).await;
    result
}

pub async fn init_bare_repo(path: &Path) -> Result<()> {
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }
    run(None, &["init", "--bare", path.to_str().ok_or_else(|| Error::Other("path utf8".into()))?])
        .await
        .map(|_| ())
}

pub async fn init_repo_with_initial_commit(path: &Path) -> Result<()> {
    tokio::fs::create_dir_all(path).await?;
    run(Some(path), &["init", "-b", "main"]).await?;
    run(Some(path), &["config", "user.email", "test@cir30.local"]).await?;
    run(Some(path), &["config", "user.name", "cir30"]).await?;
    run(Some(path), &["config", "commit.gpgsign", "false"]).await?;
    tokio::fs::write(path.join("README.md"), b"# init\n").await?;
    run(Some(path), &["add", "README.md"]).await?;
    run(Some(path), &["commit", "-m", "init"]).await?;
    Ok(())
}
