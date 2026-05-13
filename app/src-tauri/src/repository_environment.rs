use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicU64, Ordering};

use serde::Serialize;

static PROBE_COUNTER: AtomicU64 = AtomicU64::new(0);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryEnvironmentCheck {
    repo_root: CheckItem,
    git_common_dir: CheckItem,
    codex_state_dir: CheckItem,
    github_cli_auth: CheckItem,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckItem {
    ok: bool,
    message: Option<String>,
}

impl CheckItem {
    fn ok() -> Self {
        Self {
            ok: true,
            message: None,
        }
    }

    fn failed(message: impl Into<String>) -> Self {
        Self {
            ok: false,
            message: Some(message.into()),
        }
    }
}

#[tauri::command]
pub fn check_repository_environment(repo_path: String) -> RepositoryEnvironmentCheck {
    check_repository_environment_at(Path::new(&repo_path))
}

pub fn check_repository_environment_at(repo_path: &Path) -> RepositoryEnvironmentCheck {
    let repo_root = check_repo_root(repo_path);
    let git_common_dir = check_git_common_dir(repo_path);
    let codex_state_dir = check_codex_state_dir(repo_path);
    let github_cli_auth = check_github_cli_auth(repo_path);

    RepositoryEnvironmentCheck {
        repo_root,
        git_common_dir,
        codex_state_dir,
        github_cli_auth,
    }
}

fn check_repo_root(repo_path: &Path) -> CheckItem {
    if !repo_path.is_dir() {
        return CheckItem::failed(format!(
            "repository path does not exist or is not a directory: {}",
            repo_path.display()
        ));
    }

    write_probe(repo_path)
}

fn check_git_common_dir(repo_path: &Path) -> CheckItem {
    let output = match Command::new("git")
        .args(["rev-parse", "--path-format=absolute", "--git-common-dir"])
        .current_dir(repo_path)
        .output()
    {
        Ok(output) => output,
        Err(err) => return CheckItem::failed(format!("failed to run git rev-parse: {err}")),
    };

    if !output.status.success() {
        return CheckItem::failed(format!(
            "git rev-parse failed: {}",
            command_detail(&output.stdout, &output.stderr)
        ));
    }

    let raw = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if raw.is_empty() {
        return CheckItem::failed("git rev-parse returned an empty git common dir");
    }

    write_probe(&PathBuf::from(raw))
}

fn check_codex_state_dir(repo_path: &Path) -> CheckItem {
    if !repo_path.is_dir() {
        return CheckItem::failed(format!(
            "repository path does not exist or is not a directory: {}",
            repo_path.display()
        ));
    }

    let dir = repo_path.join(".codex").join("state");
    if let Err(err) = fs::create_dir_all(&dir) {
        return CheckItem::failed(format!("failed to create {}: {err}", dir.display()));
    }

    write_probe(&dir)
}

fn check_github_cli_auth(repo_path: &Path) -> CheckItem {
    let output = match Command::new("gh").args(["auth", "status"]).current_dir(repo_path).output() {
        Ok(output) => output,
        Err(err) => return CheckItem::failed(format!("failed to run gh auth status: {err}")),
    };

    if output.status.success() {
        CheckItem::ok()
    } else {
        CheckItem::failed(format!(
            "gh auth status failed: {}",
            command_detail(&output.stdout, &output.stderr)
        ))
    }
}

fn write_probe(dir: &Path) -> CheckItem {
    let probe = dir.join(format!(
        ".circuit-preflight-{}-{}.tmp",
        std::process::id(),
        PROBE_COUNTER.fetch_add(1, Ordering::Relaxed)
    ));

    if let Err(err) = fs::write(&probe, b"ok") {
        return CheckItem::failed(format!("failed to write {}: {err}", probe.display()));
    }

    if let Err(err) = fs::remove_file(&probe) {
        return CheckItem::failed(format!("failed to remove {}: {err}", probe.display()));
    }

    CheckItem::ok()
}

fn command_detail(stdout: &[u8], stderr: &[u8]) -> String {
    let stderr = String::from_utf8_lossy(stderr).trim().to_string();
    if !stderr.is_empty() {
        return stderr;
    }

    let stdout = String::from_utf8_lossy(stdout).trim().to_string();
    if stdout.is_empty() {
        "(no output)".to_string()
    } else {
        stdout
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn init_repo(path: &Path) {
        let output = Command::new("git")
            .args(["init"])
            .current_dir(path)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "git init failed: {}",
            command_detail(&output.stdout, &output.stderr)
        );
    }

    #[test]
    fn preflight_accepts_writable_git_repo() {
        let dir = tempfile::tempdir().unwrap();
        init_repo(dir.path());

        let check = check_repository_environment_at(dir.path());

        assert!(check.repo_root.ok);
        assert!(check.git_common_dir.ok);
        assert!(check.codex_state_dir.ok);
        assert!(dir.path().join(".codex").join("state").is_dir());
    }

    #[test]
    fn preflight_reports_missing_repo_path() {
        let dir = tempfile::tempdir().unwrap();
        let missing = dir.path().join("missing");

        let check = check_repository_environment_at(&missing);

        assert!(!check.repo_root.ok);
        assert!(!check.git_common_dir.ok);
        assert!(!check.codex_state_dir.ok);
        assert!(check.github_cli_auth.message.is_some() || check.github_cli_auth.ok);
    }
}
