use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;

const RUN_LOGS_SUBDIR: &str = ".circuit/run_logs";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunLogEntry {
    pub run_id: String,
    pub saved_at: String,
}

fn validate_id(id: &str, label: &str) -> Result<(), String> {
    if id.is_empty() {
        return Err(format!("{label} is empty"));
    }
    if !id
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err(format!("{label} contains illegal characters"));
    }
    Ok(())
}

fn run_logs_dir(repo_path: &str, workflow_id: &str) -> PathBuf {
    Path::new(repo_path).join(RUN_LOGS_SUBDIR).join(workflow_id)
}

fn run_log_file(repo_path: &str, workflow_id: &str, run_id: &str) -> PathBuf {
    run_logs_dir(repo_path, workflow_id).join(format!("{run_id}.jsonl"))
}

#[tauri::command]
pub fn save_run_log(
    repo_path: String,
    workflow_id: String,
    run_id: String,
    jsonl: String,
) -> Result<(), String> {
    validate_id(&workflow_id, "workflow id")?;
    validate_id(&run_id, "run id")?;

    let dir = run_logs_dir(&repo_path, &workflow_id);
    fs::create_dir_all(&dir).map_err(|e| format!("failed to mkdir {}: {e}", dir.display()))?;

    let final_path = run_log_file(&repo_path, &workflow_id, &run_id);
    let tmp_path = dir.join(format!("{run_id}.jsonl.tmp"));
    fs::write(&tmp_path, &jsonl)
        .map_err(|e| format!("failed to write {}: {e}", tmp_path.display()))?;
    fs::rename(&tmp_path, &final_path).map_err(|e| {
        let _ = fs::remove_file(&tmp_path);
        format!(
            "failed to rename {} -> {}: {e}",
            tmp_path.display(),
            final_path.display()
        )
    })
}

#[tauri::command]
pub fn list_run_logs(
    repo_path: String,
    workflow_id: String,
) -> Result<Vec<RunLogEntry>, String> {
    validate_id(&workflow_id, "workflow id")?;
    let dir = run_logs_dir(&repo_path, &workflow_id);
    if !dir.is_dir() {
        return Ok(Vec::new());
    }

    let entries = match fs::read_dir(&dir) {
        Ok(it) => it,
        Err(e) => return Err(format!("failed to read {}: {e}", dir.display())),
    };

    let mut out: Vec<(RunLogEntry, std::time::SystemTime)> = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        if path.extension().and_then(|s| s.to_str()) != Some("jsonl") {
            continue;
        }
        let run_id = match path.file_stem().and_then(|s| s.to_str()) {
            Some(s) => s.to_string(),
            None => continue,
        };
        let metadata = match fs::metadata(&path) {
            Ok(m) => m,
            Err(_) => continue,
        };
        let modified = metadata
            .modified()
            .unwrap_or(std::time::SystemTime::UNIX_EPOCH);
        let saved_at = modified
            .duration_since(std::time::UNIX_EPOCH)
            .ok()
            .map(|d| d.as_secs().to_string())
            .unwrap_or_default();
        out.push((RunLogEntry { run_id, saved_at }, modified));
    }

    out.sort_by(|a, b| {
        b.1.cmp(&a.1)
            .then_with(|| b.0.run_id.cmp(&a.0.run_id))
    });
    Ok(out.into_iter().map(|(entry, _)| entry).collect())
}

#[tauri::command]
pub fn load_run_log(
    repo_path: String,
    workflow_id: String,
    run_id: String,
) -> Result<String, String> {
    validate_id(&workflow_id, "workflow id")?;
    validate_id(&run_id, "run id")?;
    let path = run_log_file(&repo_path, &workflow_id, &run_id);
    fs::read_to_string(&path).map_err(|e| format!("failed to read {}: {e}", path.display()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};

    static COUNTER: AtomicUsize = AtomicUsize::new(0);

    fn unique_repo() -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let n = COUNTER.fetch_add(1, Ordering::Relaxed);
        let dir = std::env::temp_dir().join(format!("circuit-runlog-test-{nanos}-{n}"));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn save_then_load_round_trips_jsonl() {
        let repo = unique_repo();
        let p = repo.to_string_lossy().into_owned();
        save_run_log(
            p.clone(),
            "wf-1".into(),
            "run-1".into(),
            "{\"a\":1}\n{\"b\":2}\n".into(),
        )
        .expect("save");
        let loaded = load_run_log(p, "wf-1".into(), "run-1".into()).expect("load");
        assert_eq!(loaded, "{\"a\":1}\n{\"b\":2}\n");
    }

    #[test]
    fn list_run_logs_returns_recent_first() {
        let repo = unique_repo();
        let p = repo.to_string_lossy().into_owned();
        save_run_log(p.clone(), "wf-1".into(), "run-a".into(), "{}\n".into()).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(20));
        save_run_log(p.clone(), "wf-1".into(), "run-b".into(), "{}\n".into()).unwrap();

        let list = list_run_logs(p, "wf-1".into()).expect("list");
        assert_eq!(list.len(), 2);
        // Most recent first by mtime.
        assert_eq!(list[0].run_id, "run-b");
        assert_eq!(list[1].run_id, "run-a");
    }

    #[test]
    fn list_run_logs_empty_when_workflow_dir_missing() {
        let repo = unique_repo();
        let list = list_run_logs(repo.to_string_lossy().into_owned(), "wf-x".into()).unwrap();
        assert!(list.is_empty());
    }

    #[test]
    fn save_rejects_path_traversal_in_workflow_id() {
        let repo = unique_repo();
        let r = save_run_log(
            repo.to_string_lossy().into_owned(),
            "../escape".into(),
            "run-1".into(),
            "{}\n".into(),
        );
        assert!(r.is_err());
    }

    #[test]
    fn save_rejects_path_traversal_in_run_id() {
        let repo = unique_repo();
        let r = save_run_log(
            repo.to_string_lossy().into_owned(),
            "wf-1".into(),
            "../escape".into(),
            "{}\n".into(),
        );
        assert!(r.is_err());
    }
}
