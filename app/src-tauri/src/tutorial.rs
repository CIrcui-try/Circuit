use std::fs;
use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager};

const TUTORIAL_DIR_NAME: &str = "Circuit Tutorial";
const README: &str = "# Circuit Tutorial\n\nThis folder is a safe place to try Circuit. The starter flow will create `hello_world.html` here.\n";

#[tauri::command]
pub fn create_tutorial_repository(app: AppHandle) -> Result<String, String> {
    let data_dir = app
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("failed to resolve app data directory: {e}"))?;
    let path = create_tutorial_repository_at(&data_dir)?;
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

    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn creates_tutorial_repository_under_root() {
        let dir = tempfile::tempdir().unwrap();

        let path = create_tutorial_repository_at(dir.path()).unwrap();

        assert_eq!(path, dir.path().join(TUTORIAL_DIR_NAME));
        assert!(path.is_dir());
        assert!(path.join("README.md").is_file());
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
    }
}
