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

/// Stage every dirty change and create a single commit with `message`.
/// Returns the new HEAD SHA, or `None` when the tree was already clean.
///
/// Phase 3 (CIR-31) calls this at every turn boundary so each settled turn
/// becomes a real git commit — that is what makes `reset_hard(base_head)`
/// during crash recovery preserve prior turns' work while discarding the
/// uncommitted in-flight turn.
///
/// Author / committer identity and gpg signing are pinned via inline `-c`
/// so the commit succeeds regardless of the host's global git config.
pub async fn commit_all(workspace: &Path, message: &str) -> Result<Option<String>> {
    run(Some(workspace), &["add", "-A"]).await?;
    let staged = run(Some(workspace), &["diff", "--cached", "--name-only"]).await?;
    if staged.trim().is_empty() {
        return Ok(None);
    }
    run(
        Some(workspace),
        &[
            "-c",
            "user.email=workspace@cir31.local",
            "-c",
            "user.name=cir31-workspace",
            "-c",
            "commit.gpgsign=false",
            "commit",
            "-m",
            message,
        ],
    )
    .await?;
    let head = run(Some(workspace), &["rev-parse", "HEAD"])
        .await?
        .trim()
        .to_owned();
    Ok(Some(head))
}

/// Hard-reset the working tree to `sha` and discard every untracked file.
/// Destructive — used by Phase 3 (CIR-31) crash recovery to roll an in-flight
/// turn back to its pre-turn HEAD, which means *no* dirty residue (tracked
/// or untracked) may survive. Caller must already have validated that `sha`
/// is the known turn base, not arbitrary user input.
pub async fn reset_hard(workspace: &Path, sha: &str) -> Result<()> {
    if sha.is_empty() {
        return Err(Error::Other("reset_hard: empty sha".into()));
    }
    run(Some(workspace), &["reset", "--hard", sha]).await?;
    run(Some(workspace), &["clean", "-fd"]).await?;
    Ok(())
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
///
/// Uses `git stash push --include-untracked` (instead of `stash create + store`)
/// because the latter quietly returns empty stdout when only untracked files exist.
pub async fn stash_save(workspace: &Path, message: &str) -> Result<Option<String>> {
    // Bail early on a clean tree so we can return None deterministically.
    let entries = status(workspace).await?;
    if entries.is_empty() {
        return Ok(None);
    }
    run(
        Some(workspace),
        &["stash", "push", "--include-untracked", "-m", message],
    )
    .await?;
    // The newest stash entry is the one we just created; resolve its commit SHA.
    let sha = run(Some(workspace), &["rev-parse", "stash@{0}"])
        .await?
        .trim()
        .to_owned();
    if sha.is_empty() {
        return Ok(None);
    }
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
///
/// `git bundle` requires named refs (not bare SHAs), so we attach a temporary
/// tag pointing at the stash commit, bundle that tag, then drop it. The bundle
/// is bounded by `--not <base>` (the commit the stash was based on), keeping
/// the blob small; the destination clone must already contain `<base>`.
pub async fn export_stash_bundle(workspace: &Path, sha: &str) -> Result<Vec<u8>> {
    let base = run(Some(workspace), &["rev-parse", &format!("{sha}^1")])
        .await?
        .trim()
        .to_owned();
    let tag = format!("__cir30_stash_{}", &sha[..12.min(sha.len())]);
    // Force-update so retries don't fail.
    run(Some(workspace), &["tag", "-f", &tag, sha]).await?;
    let bundle_result = (async {
        let mut cmd = Command::new("git");
        cmd.current_dir(workspace).args([
            "bundle",
            "create",
            "-",
            &format!("refs/tags/{tag}"),
            "--not",
            &base,
        ]);
        let out = cmd.output().await?;
        if !out.status.success() {
            return Err(Error::Git {
                code: out.status.code().unwrap_or(-1),
                stderr: String::from_utf8_lossy(&out.stderr).into_owned(),
            });
        }
        Ok(out.stdout)
    })
    .await;
    let _ = run(Some(workspace), &["tag", "-d", &tag]).await;
    bundle_result
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

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;
    use tokio::fs;

    async fn fresh_repo() -> TempDir {
        let dir = TempDir::new().unwrap();
        init_repo_with_initial_commit(dir.path()).await.unwrap();
        dir
    }

    #[tokio::test]
    async fn head_and_branch_on_fresh_repo() {
        let dir = fresh_repo().await;
        let head = head_commit(dir.path()).await.unwrap();
        assert_eq!(head.len(), 40); // SHA-1 hex
        assert_eq!(
            current_branch(dir.path()).await.unwrap().as_deref(),
            Some("main")
        );
    }

    #[tokio::test]
    async fn status_lists_dirty_files() {
        let dir = fresh_repo().await;
        fs::write(dir.path().join("a.txt"), b"a\n").await.unwrap();
        fs::write(dir.path().join("README.md"), b"# changed\n")
            .await
            .unwrap();
        let entries = status(dir.path()).await.unwrap();
        let names: Vec<_> = entries
            .iter()
            .map(|e| e.path.to_string_lossy().into_owned())
            .collect();
        assert!(names.iter().any(|n| n == "a.txt"));
        assert!(names.iter().any(|n| n == "README.md"));
    }

    #[tokio::test]
    async fn stash_save_returns_sha_and_clears_working_tree() {
        let dir = fresh_repo().await;
        fs::write(dir.path().join("dirty.txt"), b"dirty\n")
            .await
            .unwrap();
        let sha = stash_save(dir.path(), "cir30")
            .await
            .unwrap()
            .expect("stash sha");
        assert_eq!(sha.len(), 40);
        let after = status(dir.path()).await.unwrap();
        assert!(
            after.is_empty(),
            "expected clean working tree after stash, got {after:?}"
        );
        // file is gone
        assert!(!dir.path().join("dirty.txt").exists());
    }

    #[tokio::test]
    async fn stash_save_on_clean_returns_none() {
        let dir = fresh_repo().await;
        let sha = stash_save(dir.path(), "noop").await.unwrap();
        assert!(sha.is_none());
    }

    #[tokio::test]
    async fn stash_apply_restores_dirty_file() {
        let dir = fresh_repo().await;
        fs::write(dir.path().join("dirty.txt"), b"dirty\n")
            .await
            .unwrap();
        let sha = stash_save(dir.path(), "cir30").await.unwrap().unwrap();
        // Working tree clean, file gone.
        assert!(!dir.path().join("dirty.txt").exists());
        stash_apply(dir.path(), &sha).await.unwrap();
        let restored = fs::read(dir.path().join("dirty.txt")).await.unwrap();
        assert_eq!(restored, b"dirty\n");
    }

    #[tokio::test]
    async fn clone_from_local_repo() {
        let src = fresh_repo().await;
        let dst_parent = TempDir::new().unwrap();
        let dst = dst_parent.path().join("clone");
        let src_url = format!("file://{}", src.path().display());
        clone(&src_url, &dst).await.unwrap();
        let head_src = head_commit(src.path()).await.unwrap();
        let head_dst = head_commit(&dst).await.unwrap();
        assert_eq!(head_src, head_dst);
    }

    #[tokio::test]
    async fn checkout_existing_branch() {
        let dir = fresh_repo().await;
        // create another branch
        run(Some(dir.path()), &["checkout", "-b", "feature"])
            .await
            .unwrap();
        checkout(dir.path(), "main").await.unwrap();
        assert_eq!(
            current_branch(dir.path()).await.unwrap().as_deref(),
            Some("main")
        );
    }

    #[tokio::test]
    async fn reset_hard_drops_dirty_changes_and_reverts_head() {
        let dir = fresh_repo().await;
        let head = head_commit(dir.path()).await.unwrap();
        // Add a second commit so HEAD has somewhere to be moved back from.
        fs::write(dir.path().join("README.md"), b"# changed\n")
            .await
            .unwrap();
        run(Some(dir.path()), &["add", "README.md"]).await.unwrap();
        run(Some(dir.path()), &["commit", "-m", "second"])
            .await
            .unwrap();
        // Plus an uncommitted dirty file.
        fs::write(dir.path().join("dirty.txt"), b"WIP\n")
            .await
            .unwrap();

        reset_hard(dir.path(), &head).await.unwrap();
        assert_eq!(head_commit(dir.path()).await.unwrap(), head);
        assert!(!dir.path().join("dirty.txt").exists());
        let restored = fs::read(dir.path().join("README.md")).await.unwrap();
        assert_eq!(restored, b"# init\n");
    }

    #[tokio::test]
    async fn reset_hard_rejects_empty_sha() {
        let dir = fresh_repo().await;
        let result = reset_hard(dir.path(), "").await;
        assert!(matches!(result, Err(Error::Other(_))));
    }

    #[tokio::test]
    async fn export_and_import_stash_bundle() {
        let dir = fresh_repo().await;
        fs::write(dir.path().join("dirty.txt"), b"dirty\n")
            .await
            .unwrap();
        let sha = stash_save(dir.path(), "cir30").await.unwrap().unwrap();
        let bundle = export_stash_bundle(dir.path(), &sha).await.unwrap();
        assert!(!bundle.is_empty());

        // simulate clone then re-import
        let dst_parent = TempDir::new().unwrap();
        let dst = dst_parent.path().join("re");
        let src_url = format!("file://{}", dir.path().display());
        clone(&src_url, &dst).await.unwrap();
        import_stash_bundle(&dst, &bundle).await.unwrap();
        stash_apply(&dst, &sha).await.unwrap();
        let restored = fs::read(dst.join("dirty.txt")).await.unwrap();
        assert_eq!(restored, b"dirty\n");
    }
}
