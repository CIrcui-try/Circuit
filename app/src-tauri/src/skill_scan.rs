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

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture_repo() -> PathBuf {
        let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        manifest
            .join("..")
            .join("..")
            .join("fixtures")
            .join("repos")
            .join("sample-repo")
    }

    #[test]
    fn scan_skills_returns_only_recognized_skill_dirs() {
        let repo = fixture_repo();
        assert!(
            repo.is_dir(),
            "fixture repo missing at {}",
            repo.display()
        );

        let skills = scan_skills(repo.to_string_lossy().into_owned()).expect("scan failed");

        let names: Vec<&str> = skills.iter().map(|s| s.dir_name.as_str()).collect();
        assert_eq!(skills.len(), 2, "expected exactly 2 skills, got {names:?}");

        let providers: Vec<&str> = skills.iter().map(|s| s.provider.as_str()).collect();
        assert!(providers.contains(&"claude"));
        assert!(providers.contains(&"codex"));

        for s in &skills {
            assert!(
                !s.root_dir.contains("docs/"),
                "ignored-skill leaked into results: {}",
                s.root_dir
            );
        }

        let claude = skills.iter().find(|s| s.provider == "claude").unwrap();
        assert_eq!(claude.dir_name, "implement-feature");
        assert_eq!(claude.root_dir, ".claude/skills/implement-feature");

        let codex = skills.iter().find(|s| s.provider == "codex").unwrap();
        assert_eq!(codex.dir_name, "review-code");
        assert_eq!(codex.root_dir, ".codex/skills/review-code");
    }

    #[test]
    fn scan_skills_errors_for_missing_dir() {
        let result = scan_skills("/definitely/does/not/exist".into());
        assert!(result.is_err());
    }
}
