use std::fs;
use std::path::{Component, Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowSummary {
    pub id: String,
    pub name: String,
    pub updated_at: String,
}

const WORKFLOWS_SUBDIR: &str = ".circuit/workflows";
const BUNDLE_VERSION: &str = "0.1";

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

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowBundleSkill {
    pub provider: String,
    pub skill_file: String,
    pub content: String,
    pub content_hash: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowBundle {
    pub version: String,
    pub exported_at: String,
    pub workflow: Value,
    pub skills: Vec<WorkflowBundleSkill>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowBundleExportSummary {
    pub path: String,
    pub skill_count: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowBundleSkillConflict {
    pub skill_file: String,
    pub existing_hash: String,
    pub incoming_hash: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowBundleImportPreview {
    pub bundle_path: String,
    pub workflow_name: String,
    pub skill_count: usize,
    pub missing_skills: Vec<String>,
    pub reused_skills: Vec<String>,
    pub conflicts: Vec<WorkflowBundleSkillConflict>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowBundleSkillResolution {
    pub skill_file: String,
    pub action: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowBundleImportResult {
    pub workflow_id: String,
    pub workflow_json: String,
    pub installed_skills: Vec<String>,
    pub reused_skills: Vec<String>,
    pub skipped_skills: Vec<String>,
    pub overwritten_skills: Vec<String>,
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

#[tauri::command]
pub fn export_workflow_bundle(
    repo_path: String,
    workflow_json: String,
    exported_at: String,
    export_path: String,
) -> Result<WorkflowBundleExportSummary, String> {
    let workflow: Value = serde_json::from_str(&workflow_json)
        .map_err(|e| format!("workflow json is invalid: {e}"))?;
    let skills = collect_bundle_skills(&repo_path, &workflow)?;
    let bundle = WorkflowBundle {
        version: BUNDLE_VERSION.to_string(),
        exported_at,
        workflow,
        skills,
    };
    let json = serde_json::to_string_pretty(&bundle)
        .map_err(|e| format!("failed to serialize workflow bundle: {e}"))?;
    let path = PathBuf::from(&export_path);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("failed to create {}: {e}", parent.display()))?;
    }
    fs::write(&path, json).map_err(|e| format!("failed to write {}: {e}", path.display()))?;
    Ok(WorkflowBundleExportSummary {
        path: export_path,
        skill_count: bundle.skills.len(),
    })
}

#[tauri::command]
pub fn preview_workflow_bundle_import(
    repo_path: String,
    bundle_path: String,
) -> Result<WorkflowBundleImportPreview, String> {
    let bundle = read_bundle(&bundle_path)?;
    let mut missing_skills = Vec::new();
    let mut reused_skills = Vec::new();
    let mut conflicts = Vec::new();

    for skill in &bundle.skills {
        validate_bundle_skill(skill)?;
        let target = resolve_repository_skill_path(&repo_path, &skill.skill_file)?;
        if !target.is_file() {
            missing_skills.push(skill.skill_file.clone());
            continue;
        }
        let existing = fs::read_to_string(&target)
            .map_err(|e| format!("failed to read {}: {e}", target.display()))?;
        let existing_hash = content_hash(&existing);
        if existing_hash == skill.content_hash {
            reused_skills.push(skill.skill_file.clone());
        } else {
            conflicts.push(WorkflowBundleSkillConflict {
                skill_file: skill.skill_file.clone(),
                existing_hash,
                incoming_hash: skill.content_hash.clone(),
            });
        }
    }

    Ok(WorkflowBundleImportPreview {
        bundle_path,
        workflow_name: bundle
            .workflow
            .get("name")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        skill_count: bundle.skills.len(),
        missing_skills,
        reused_skills,
        conflicts,
    })
}

#[tauri::command]
pub fn import_workflow_bundle(
    repo_path: String,
    repository_id: String,
    bundle_path: String,
    workflow_id: String,
    now: String,
    resolutions: Vec<WorkflowBundleSkillResolution>,
) -> Result<WorkflowBundleImportResult, String> {
    validate_workflow_id(&workflow_id)?;
    if repository_id.trim().is_empty() {
        return Err("repository id is required".into());
    }
    let bundle = read_bundle(&bundle_path)?;
    let mut installed_skills = Vec::new();
    let mut reused_skills = Vec::new();
    let mut skipped_skills = Vec::new();
    let mut overwritten_skills = Vec::new();

    for skill in &bundle.skills {
        validate_bundle_skill(skill)?;
        let target = resolve_repository_skill_path(&repo_path, &skill.skill_file)?;
        if target.is_file() {
            let existing = fs::read_to_string(&target)
                .map_err(|e| format!("failed to read {}: {e}", target.display()))?;
            let existing_hash = content_hash(&existing);
            if existing_hash == skill.content_hash {
                reused_skills.push(skill.skill_file.clone());
                continue;
            }
            match resolution_for(&resolutions, &skill.skill_file) {
                "overwrite" => {
                    fs::write(&target, &skill.content)
                        .map_err(|e| format!("failed to write {}: {e}", target.display()))?;
                    overwritten_skills.push(skill.skill_file.clone());
                }
                _ => skipped_skills.push(skill.skill_file.clone()),
            }
            continue;
        }

        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("failed to create {}: {e}", parent.display()))?;
        }
        fs::write(&target, &skill.content)
            .map_err(|e| format!("failed to write {}: {e}", target.display()))?;
        installed_skills.push(skill.skill_file.clone());
    }

    let mut workflow = bundle.workflow;
    let obj = workflow
        .as_object_mut()
        .ok_or_else(|| "bundle workflow must be an object".to_string())?;
    obj.insert("id".to_string(), json!(workflow_id.clone()));
    obj.insert("repositoryId".to_string(), json!(repository_id));
    obj.insert("createdAt".to_string(), json!(now.clone()));
    obj.insert("updatedAt".to_string(), json!(now));
    let workflow_json = serde_json::to_string_pretty(&workflow)
        .map_err(|e| format!("failed to serialize workflow: {e}"))?;
    save_workflow(repo_path, workflow_id.clone(), workflow_json.clone())?;

    Ok(WorkflowBundleImportResult {
        workflow_id,
        workflow_json,
        installed_skills,
        reused_skills,
        skipped_skills,
        overwritten_skills,
    })
}

fn collect_bundle_skills(
    repo_path: &str,
    workflow: &Value,
) -> Result<Vec<WorkflowBundleSkill>, String> {
    let nodes = workflow
        .get("nodes")
        .and_then(|v| v.as_array())
        .ok_or_else(|| "workflow.nodes must be an array".to_string())?;
    let mut skills = Vec::new();
    let mut seen = Vec::<String>::new();
    for node in nodes {
        let Some(skill_ref) = node.get("skillRef").and_then(|v| v.as_object()) else {
            continue;
        };
        let source = skill_ref
            .get("source")
            .and_then(|v| v.as_str())
            .unwrap_or("repository");
        if source != "repository" {
            continue;
        }
        let provider = skill_ref
            .get("provider")
            .and_then(|v| v.as_str())
            .ok_or_else(|| "repository skillRef.provider is required".to_string())?;
        let skill_file = skill_ref
            .get("skillFile")
            .and_then(|v| v.as_str())
            .ok_or_else(|| "repository skillRef.skillFile is required".to_string())?;
        if seen.iter().any(|s| s == skill_file) {
            continue;
        }
        let path = resolve_repository_skill_path(repo_path, skill_file)?;
        let content = fs::read_to_string(&path)
            .map_err(|e| format!("failed to read {}: {e}", path.display()))?;
        skills.push(WorkflowBundleSkill {
            provider: provider.to_string(),
            skill_file: skill_file.to_string(),
            content_hash: content_hash(&content),
            content,
        });
        seen.push(skill_file.to_string());
    }
    Ok(skills)
}

fn read_bundle(bundle_path: &str) -> Result<WorkflowBundle, String> {
    let raw = fs::read_to_string(bundle_path)
        .map_err(|e| format!("failed to read {bundle_path}: {e}"))?;
    let bundle: WorkflowBundle = serde_json::from_str(&raw)
        .map_err(|e| format!("workflow bundle is invalid: {e}"))?;
    if bundle.version != BUNDLE_VERSION {
        return Err(format!(
            "unsupported workflow bundle version: {}",
            bundle.version
        ));
    }
    if !bundle.workflow.is_object() {
        return Err("bundle workflow must be an object".into());
    }
    for skill in &bundle.skills {
        validate_bundle_skill(skill)?;
    }
    Ok(bundle)
}

fn validate_bundle_skill(skill: &WorkflowBundleSkill) -> Result<(), String> {
    if skill.provider != "claude" && skill.provider != "codex" {
        return Err(format!("unsupported skill provider: {}", skill.provider));
    }
    let expected_prefix = format!(".{}/skills/", skill.provider);
    if !skill.skill_file.starts_with(&expected_prefix) {
        return Err(format!(
            "skill file does not match provider {}: {}",
            skill.provider, skill.skill_file
        ));
    }
    resolve_skill_parts(&skill.skill_file)?;
    let actual = content_hash(&skill.content);
    if actual != skill.content_hash {
        return Err(format!("skill hash mismatch: {}", skill.skill_file));
    }
    Ok(())
}

fn resolve_repository_skill_path(repo_path: &str, skill_file: &str) -> Result<PathBuf, String> {
    resolve_skill_parts(skill_file)?;
    Ok(Path::new(repo_path).join(skill_file))
}

fn resolve_skill_parts(skill_file: &str) -> Result<(&str, &str), String> {
    let path = Path::new(skill_file);
    let parts: Vec<&str> = path
        .components()
        .map(|component| match component {
            Component::Normal(value) => value.to_str().unwrap_or(""),
            _ => "",
        })
        .collect();
    if parts.len() != 4 || parts[1] != "skills" || parts[3] != "SKILL.md" {
        return Err(format!("invalid bundled skill path: {skill_file}"));
    }
    let provider_dir = parts[0];
    if provider_dir != ".claude" && provider_dir != ".codex" {
        return Err(format!("invalid bundled skill provider path: {skill_file}"));
    }
    let slug = parts[2];
    if slug.is_empty()
        || !slug
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err(format!("invalid bundled skill slug: {skill_file}"));
    }
    Ok((provider_dir, slug))
}

fn resolution_for<'a>(
    resolutions: &'a [WorkflowBundleSkillResolution],
    skill_file: &str,
) -> &'a str {
    resolutions
        .iter()
        .find(|r| r.skill_file == skill_file)
        .map(|r| r.action.as_str())
        .unwrap_or("skip")
}

fn content_hash(content: &str) -> String {
    let mut hash: u64 = 0xcbf29ce484222325;
    for byte in content.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("fnv1a64:{hash:016x}")
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

    fn workflow_with_repository_skill() -> String {
        r#"{
  "version": "0.1",
  "id": "source-wf",
  "repositoryId": "source-repo",
  "name": "Shared flow",
  "nodes": [
    {
      "id": "n1",
      "type": "skill",
      "skillRef": {
        "source": "repository",
        "provider": "codex",
        "skillFile": ".codex/skills/review/SKILL.md"
      },
      "label": "Review",
      "position": { "x": 1, "y": 2 }
    },
    {
      "id": "n2",
      "type": "skill",
      "skillRef": {
        "source": "default",
        "provider": "codex",
        "skillFile": ".codex/skills/wrap-up/SKILL.md"
      },
      "label": "Wrap up",
      "position": { "x": 3, "y": 4 }
    }
  ],
  "edges": [],
  "createdAt": "2026-01-01T00:00:00Z",
  "updatedAt": "2026-01-01T00:00:00Z"
}"#
        .to_string()
    }

    fn write_review_skill(repo: &Path, content: &str) {
        let path = repo.join(".codex").join("skills").join("review");
        fs::create_dir_all(&path).unwrap();
        fs::write(path.join("SKILL.md"), content).unwrap();
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

    #[test]
    fn export_bundle_includes_only_repository_skills() {
        let repo = unique_repo();
        write_review_skill(&repo, "---\nname: Review\n---\n");
        let bundle_path = repo.join("shared.circuitflow");

        let summary = export_workflow_bundle(
            repo.to_string_lossy().into_owned(),
            workflow_with_repository_skill(),
            "2026-05-21T00:00:00Z".into(),
            bundle_path.to_string_lossy().into_owned(),
        )
        .expect("export failed");

        assert_eq!(summary.skill_count, 1);
        let raw = fs::read_to_string(bundle_path).unwrap();
        let bundle: WorkflowBundle = serde_json::from_str(&raw).unwrap();
        assert_eq!(bundle.version, BUNDLE_VERSION);
        assert_eq!(bundle.skills.len(), 1);
        assert_eq!(bundle.skills[0].skill_file, ".codex/skills/review/SKILL.md");
        assert_eq!(bundle.skills[0].content_hash, content_hash(&bundle.skills[0].content));
    }

    #[test]
    fn import_bundle_rewrites_workflow_identity_and_installs_missing_skill() {
        let source = unique_repo();
        write_review_skill(&source, "---\nname: Review\n---\n");
        let bundle_path = source.join("shared.circuitflow");
        export_workflow_bundle(
            source.to_string_lossy().into_owned(),
            workflow_with_repository_skill(),
            "2026-05-21T00:00:00Z".into(),
            bundle_path.to_string_lossy().into_owned(),
        )
        .unwrap();

        let target = unique_repo();
        let result = import_workflow_bundle(
            target.to_string_lossy().into_owned(),
            "target-repo".into(),
            bundle_path.to_string_lossy().into_owned(),
            "imported-wf".into(),
            "2026-05-22T00:00:00Z".into(),
            Vec::new(),
        )
        .expect("import failed");

        assert_eq!(result.workflow_id, "imported-wf");
        assert_eq!(result.installed_skills, vec![".codex/skills/review/SKILL.md"]);
        let workflow: Value = serde_json::from_str(&result.workflow_json).unwrap();
        assert_eq!(workflow["id"], "imported-wf");
        assert_eq!(workflow["repositoryId"], "target-repo");
        assert!(target
            .join(".codex")
            .join("skills")
            .join("review")
            .join("SKILL.md")
            .is_file());
    }

    #[test]
    fn import_bundle_reuses_same_hash_and_skips_conflict_by_default() {
        let source = unique_repo();
        let skill_content = "---\nname: Review\n---\n";
        write_review_skill(&source, skill_content);
        let bundle_path = source.join("shared.circuitflow");
        export_workflow_bundle(
            source.to_string_lossy().into_owned(),
            workflow_with_repository_skill(),
            "2026-05-21T00:00:00Z".into(),
            bundle_path.to_string_lossy().into_owned(),
        )
        .unwrap();

        let same = unique_repo();
        write_review_skill(&same, skill_content);
        let preview = preview_workflow_bundle_import(
            same.to_string_lossy().into_owned(),
            bundle_path.to_string_lossy().into_owned(),
        )
        .unwrap();
        assert_eq!(preview.reused_skills, vec![".codex/skills/review/SKILL.md"]);
        assert!(preview.conflicts.is_empty());

        let conflict = unique_repo();
        write_review_skill(&conflict, "---\nname: Local Review\n---\n");
        let preview = preview_workflow_bundle_import(
            conflict.to_string_lossy().into_owned(),
            bundle_path.to_string_lossy().into_owned(),
        )
        .unwrap();
        assert_eq!(preview.conflicts.len(), 1);

        let result = import_workflow_bundle(
            conflict.to_string_lossy().into_owned(),
            "repo".into(),
            bundle_path.to_string_lossy().into_owned(),
            "wf-skip".into(),
            "2026-05-22T00:00:00Z".into(),
            Vec::new(),
        )
        .unwrap();
        assert_eq!(result.skipped_skills, vec![".codex/skills/review/SKILL.md"]);
        let local = fs::read_to_string(
            conflict
                .join(".codex")
                .join("skills")
                .join("review")
                .join("SKILL.md"),
        )
        .unwrap();
        assert!(local.contains("Local Review"));
    }

    #[test]
    fn import_bundle_overwrites_conflict_when_requested() {
        let source = unique_repo();
        write_review_skill(&source, "---\nname: Incoming Review\n---\n");
        let bundle_path = source.join("shared.circuitflow");
        export_workflow_bundle(
            source.to_string_lossy().into_owned(),
            workflow_with_repository_skill(),
            "2026-05-21T00:00:00Z".into(),
            bundle_path.to_string_lossy().into_owned(),
        )
        .unwrap();

        let target = unique_repo();
        write_review_skill(&target, "---\nname: Local Review\n---\n");
        let result = import_workflow_bundle(
            target.to_string_lossy().into_owned(),
            "repo".into(),
            bundle_path.to_string_lossy().into_owned(),
            "wf-overwrite".into(),
            "2026-05-22T00:00:00Z".into(),
            vec![WorkflowBundleSkillResolution {
                skill_file: ".codex/skills/review/SKILL.md".into(),
                action: "overwrite".into(),
            }],
        )
        .unwrap();

        assert_eq!(result.overwritten_skills, vec![".codex/skills/review/SKILL.md"]);
        let local = fs::read_to_string(
            target
                .join(".codex")
                .join("skills")
                .join("review")
                .join("SKILL.md"),
        )
        .unwrap();
        assert!(local.contains("Incoming Review"));
    }

    #[test]
    fn import_bundle_rejects_skill_path_traversal() {
        let repo = unique_repo();
        let bundle_path = repo.join("bad.circuitflow");
        let content = "---\nname: Bad\n---\n";
        let bundle = WorkflowBundle {
            version: BUNDLE_VERSION.to_string(),
            exported_at: "2026-05-21T00:00:00Z".into(),
            workflow: serde_json::from_str(&sample_workflow_json(
                "wf",
                "Bad",
                "2026-05-21T00:00:00Z",
            ))
            .unwrap(),
            skills: vec![WorkflowBundleSkill {
                provider: "codex".into(),
                skill_file: ".codex/skills/../escape/SKILL.md".into(),
                content: content.into(),
                content_hash: content_hash(content),
            }],
        };
        fs::write(&bundle_path, serde_json::to_string(&bundle).unwrap()).unwrap();

        let result = preview_workflow_bundle_import(
            repo.to_string_lossy().into_owned(),
            bundle_path.to_string_lossy().into_owned(),
        );
        assert!(result.is_err());
    }
}
