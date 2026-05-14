use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use tauri::{AppHandle, Manager};

const TUTORIAL_DIR_NAME: &str = "Circuit Tutorial";
const README: &str = "# Circuit Tutorial\n\nThis folder is a safe place to try Circuit. The starter flow will create `hello_world.html` here.\n";

#[tauri::command]
pub fn create_tutorial_repository(app: AppHandle) -> Result<String, String> {
    let documents_dir = app
        .path()
        .document_dir()
        .map_err(|e| format!("failed to resolve documents directory: {e}"))?;
    let path = create_tutorial_repository_at(&documents_dir)?;
    Ok(path.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn path_exists(path: String) -> bool {
    PathBuf::from(path).exists()
}

pub fn create_tutorial_repository_at(root: &Path) -> Result<PathBuf, String> {
    let path = root.join(TUTORIAL_DIR_NAME);
    fs::create_dir_all(&path)
        .map_err(|e| format!("failed to create {}: {e}", path.display()))?;

    let readme_path = path.join("README.md");
    if !readme_path.exists() {
        fs::write(&readme_path, README)
            .map_err(|e| format!("failed to write {}: {e}", readme_path.display()))?;
    }

    ensure_git_repository(&path)?;

    Ok(path)
}

fn ensure_git_repository(path: &Path) -> Result<(), String> {
    if !path.join(".git").is_dir() {
        run_git(path, &["init"])?;
    }

    run_git(path, &["config", "user.name", "Circuit Tutorial"])?;
    run_git(path, &["config", "user.email", "tutorial@circuit.local"])?;

    if !git_head_exists(path)? {
        run_git(path, &["add", "README.md"])?;
        run_git(path, &["commit", "-m", "Initial tutorial commit"])?;
    }

    Ok(())
}

fn git_head_exists(path: &Path) -> Result<bool, String> {
    let output = Command::new("git")
        .args(["rev-parse", "--verify", "HEAD"])
        .current_dir(path)
        .output()
        .map_err(|e| format!("failed to run git rev-parse in {}: {e}", path.display()))?;

    Ok(output.status.success())
}

fn run_git(path: &Path, args: &[&str]) -> Result<(), String> {
    let output = Command::new("git")
        .args(args)
        .current_dir(path)
        .output()
        .map_err(|e| {
            format!(
                "failed to run git {} in {}: {e}",
                args.join(" "),
                path.display()
            )
        })?;

    if output.status.success() {
        return Ok(());
    }

    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let detail = if stderr.is_empty() { stdout } else { stderr };

    Err(format!(
        "git {} failed in {}: {}",
        args.join(" "),
        path.display(),
        detail
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn creates_tutorial_repository_under_user_visible_root() {
        let dir = tempfile::tempdir().unwrap();

        let path = create_tutorial_repository_at(dir.path()).unwrap();

        assert_eq!(path, dir.path().join(TUTORIAL_DIR_NAME));
        assert!(path.is_dir());
        assert!(path.join("README.md").is_file());
        assert!(path.join(".git").is_dir());
        assert!(git_head_exists(&path).unwrap());
        let remote_output = Command::new("git")
            .args(["remote"])
            .current_dir(&path)
            .output()
            .unwrap();
        assert!(remote_output.status.success());
        assert!(String::from_utf8(remote_output.stdout)
            .unwrap()
            .trim()
            .is_empty());
        assert!(path.starts_with(dir.path()));
    }

    #[test]
    fn preserves_existing_readme() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(TUTORIAL_DIR_NAME);
        fs::create_dir_all(&path).unwrap();
        fs::write(path.join("README.md"), "custom").unwrap();

        create_tutorial_repository_at(dir.path()).unwrap();

        assert_eq!(fs::read_to_string(path.join("README.md")).unwrap(), "custom");
        assert!(path.join(".git").is_dir());
        assert!(git_head_exists(&path).unwrap());
    }

    #[test]
    fn repairs_existing_folder_without_git() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(TUTORIAL_DIR_NAME);
        fs::create_dir_all(&path).unwrap();

        create_tutorial_repository_at(dir.path()).unwrap();

        assert!(path.join(".git").is_dir());
        assert!(git_head_exists(&path).unwrap());
    }
}
