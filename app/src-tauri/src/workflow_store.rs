use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_json::Value;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowSummary {
    pub id: String,
    pub name: String,
    pub updated_at: String,
}

const WORKFLOWS_SUBDIR: &str = ".circuit/workflows";

fn validate_workflow_id(id: &str) -> Result<(), String> {
    if id.is_empty() {
        return Err("workflow id is empty".into());
    }
    if !id
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err("workflow id contains illegal characters".into());
    }
    Ok(())
}

fn workflows_dir(repo_path: &str) -> PathBuf {
    Path::new(repo_path).join(WORKFLOWS_SUBDIR)
}

fn workflow_file(repo_path: &str, workflow_id: &str) -> PathBuf {
    workflows_dir(repo_path).join(format!("{workflow_id}.json"))
}

#[tauri::command]
pub fn list_workflows(repo_path: String) -> Result<Vec<WorkflowSummary>, String> {
    let dir = workflows_dir(&repo_path);
    if !dir.is_dir() {
        return Ok(Vec::new());
    }

    let entries = match fs::read_dir(&dir) {
        Ok(it) => it,
        Err(e) => return Err(format!("failed to read {}: {e}", dir.display())),
    };

    let mut out: Vec<WorkflowSummary> = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        if path.extension().and_then(|s| s.to_str()) != Some("json") {
            continue;
        }
        let bytes = match fs::read_to_string(&path) {
            Ok(s) => s,
            Err(_) => continue,
        };
        let v: Value = match serde_json::from_str(&bytes) {
            Ok(v) => v,
            Err(_) => continue,
        };
        let id = match v.get("id").and_then(|x| x.as_str()) {
            Some(s) => s.to_string(),
            None => continue,
        };
        let name = v
            .get("name")
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .to_string();
        let updated_at = v
            .get("updatedAt")
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .to_string();
        out.push(WorkflowSummary {
            id,
            name,
            updated_at,
        });
    }

    out.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    Ok(out)
}

#[tauri::command]
pub fn load_workflow(repo_path: String, workflow_id: String) -> Result<String, String> {
    validate_workflow_id(&workflow_id)?;
    let path = workflow_file(&repo_path, &workflow_id);
    fs::read_to_string(&path).map_err(|e| format!("failed to read {}: {e}", path.display()))
}

#[tauri::command]
pub fn save_workflow(
    repo_path: String,
    workflow_id: String,
    json: String,
) -> Result<(), String> {
    validate_workflow_id(&workflow_id)?;
    let dir = workflows_dir(&repo_path);
    fs::create_dir_all(&dir).map_err(|e| format!("failed to mkdir {}: {e}", dir.display()))?;

    let final_path = workflow_file(&repo_path, &workflow_id);
    let tmp_path = dir.join(format!("{workflow_id}.json.tmp"));
    fs::write(&tmp_path, &json)
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
        let dir = std::env::temp_dir().join(format!("circuit-test-repo-{nanos}-{n}"));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn sample_workflow_json(id: &str, name: &str, updated_at: &str) -> String {
        format!(
            r#"{{"version":"0.1","id":"{id}","repositoryId":"r","name":"{name}","nodes":[],"edges":[],"createdAt":"2026-01-01T00:00:00Z","updatedAt":"{updated_at}"}}"#
        )
    }

    #[test]
    fn save_then_load_round_trips_json() {
        let repo = unique_repo();
        let json = sample_workflow_json("abc-123", "Demo", "2026-04-30T00:00:00Z");
        save_workflow(
            repo.to_string_lossy().into_owned(),
            "abc-123".into(),
            json.clone(),
        )
        .expect("save failed");
        let loaded = load_workflow(
            repo.to_string_lossy().into_owned(),
            "abc-123".into(),
        )
        .expect("load failed");
        assert_eq!(loaded, json);
    }

    #[test]
    fn list_workflows_returns_summaries_sorted_desc() {
        let repo = unique_repo();
        let p = repo.to_string_lossy().into_owned();
        save_workflow(
            p.clone(),
            "id-old".into(),
            sample_workflow_json("id-old", "Older", "2026-04-01T00:00:00Z"),
        )
        .unwrap();
        save_workflow(
            p.clone(),
            "id-new".into(),
            sample_workflow_json("id-new", "Newer", "2026-04-30T00:00:00Z"),
        )
        .unwrap();

        let list = list_workflows(p).expect("list failed");
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].id, "id-new");
        assert_eq!(list[0].name, "Newer");
        assert_eq!(list[1].id, "id-old");
    }

    #[test]
    fn list_workflows_returns_empty_when_dir_missing() {
        let repo = unique_repo();
        let list = list_workflows(repo.to_string_lossy().into_owned()).expect("list failed");
        assert!(list.is_empty());
    }

    #[test]
    fn save_workflow_rejects_path_traversal() {
        let repo = unique_repo();
        let result = save_workflow(
            repo.to_string_lossy().into_owned(),
            "../escape".into(),
            "{}".into(),
        );
        assert!(result.is_err());
    }

    #[test]
    fn load_workflow_rejects_illegal_id() {
        let repo = unique_repo();
        let result = load_workflow(
            repo.to_string_lossy().into_owned(),
            "../etc/passwd".into(),
        );
        assert!(result.is_err());
    }
}
