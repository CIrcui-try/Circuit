use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RawSkill {
    pub provider: String,
    pub dir_name: String,
    pub root_dir: String,
    pub skill_file: String,
    pub content: String,
}

const PROVIDERS: [&str; 2] = ["claude", "codex"];
const MAX_CONTENT_BYTES: usize = 16 * 1024;

#[tauri::command]
pub fn scan_skills(repo_path: String) -> Result<Vec<RawSkill>, String> {
    let repo = PathBuf::from(&repo_path);
    if !repo.is_dir() {
        return Err("repository path does not exist".into());
    }

    let mut out: Vec<RawSkill> = Vec::new();
    for provider in PROVIDERS {
        let skills_dir = repo.join(format!(".{provider}")).join("skills");
        if !skills_dir.is_dir() {
            continue;
        }
        let entries = match fs::read_dir(&skills_dir) {
            Ok(it) => it,
            Err(e) => return Err(format!("failed to read {}: {e}", skills_dir.display())),
        };

        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            let dir_name = match path.file_name().and_then(|s| s.to_str()) {
                Some(s) => s.to_string(),
                None => continue,
            };

            let (skill_file_name, skill_file_path) = match resolve_skill_file(&path) {
                Some(v) => v,
                None => continue,
            };

            let content = match fs::read_to_string(&skill_file_path) {
                Ok(s) => truncate_chars(&s, MAX_CONTENT_BYTES),
                Err(e) => {
                    return Err(format!(
                        "failed to read {}: {e}",
                        skill_file_path.display()
                    ))
                }
            };

            let root_dir = format!(".{provider}/skills/{dir_name}");
            let skill_file = format!("{root_dir}/{skill_file_name}");

            out.push(RawSkill {
                provider: provider.to_string(),
                dir_name,
                root_dir,
                skill_file,
                content,
            });
        }
    }

    out.sort_by(|a, b| {
        a.provider
            .cmp(&b.provider)
            .then_with(|| a.dir_name.cmp(&b.dir_name))
    });
    Ok(out)
}

fn resolve_skill_file(skill_dir: &Path) -> Option<(&'static str, PathBuf)> {
    for name in ["SKILL.md", "skill.md"] {
        let candidate = skill_dir.join(name);
        if candidate.is_file() {
            return Some((name, candidate));
        }
    }
    None
}

fn truncate_chars(input: &str, max_bytes: usize) -> String {
    if input.len() <= max_bytes {
        return input.to_string();
    }
    let mut end = max_bytes;
    while end > 0 && !input.is_char_boundary(end) {
        end -= 1;
    }
    input[..end].to_string()
}
