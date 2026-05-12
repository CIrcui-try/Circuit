use std::fs;
use std::path::{Component, Path, PathBuf};

use serde::Serialize;
use tauri::{AppHandle, Manager};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RawSkill {
    pub provider: String,
    pub source: String,
    pub dir_name: String,
    pub root_dir: String,
    pub skill_file: String,
    pub skill_file_abs_path: String,
    pub content: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RawSystemSkill {
    pub id: String,
    pub provider: String,
    pub name: String,
    pub description: String,
    pub source: String,
}

struct SystemSkillCatalogEntry {
    provider: &'static str,
    id: &'static str,
    dir_name: &'static str,
    content: &'static str,
}

const PROVIDERS: [&str; 2] = ["claude", "codex"];
const MAX_CONTENT_BYTES: usize = 16 * 1024;
const SYSTEM_SKILL_CATALOG: [SystemSkillCatalogEntry; 6] = [
    SystemSkillCatalogEntry {
        provider: "codex",
        id: "codex:imagegen",
        dir_name: "imagegen",
        content: include_str!("../system-skills/codex/imagegen/SKILL.md"),
    },
    SystemSkillCatalogEntry {
        provider: "codex",
        id: "codex:starter/boarding",
        dir_name: "boarding",
        content: include_str!("../system-skills/codex/starter/boarding/SKILL.md"),
    },
    SystemSkillCatalogEntry {
        provider: "claude",
        id: "claude:starter/landing",
        dir_name: "landing",
        content: include_str!("../system-skills/claude/starter/landing/SKILL.md"),
    },
    SystemSkillCatalogEntry {
        provider: "claude",
        id: "claude:starter/takeoff",
        dir_name: "takeoff",
        content: include_str!("../system-skills/claude/starter/takeoff/SKILL.md"),
    },
    SystemSkillCatalogEntry {
        provider: "claude",
        id: "claude:starter/taxiing",
        dir_name: "taxiing",
        content: include_str!("../system-skills/claude/starter/taxiing/SKILL.md"),
    },
    SystemSkillCatalogEntry {
        provider: "codex",
        id: "codex:starter/review-and-fix",
        dir_name: "review-and-fix",
        content: include_str!("../system-skills/codex/starter/review-and-fix/SKILL.md"),
    },
];

#[tauri::command]
pub fn scan_skills(repo_path: String) -> Result<Vec<RawSkill>, String> {
    let repo = PathBuf::from(&repo_path);
    if !repo.is_dir() {
        return Err("repository path does not exist".into());
    }

    scan_skill_root(&repo, "repository")
}

#[tauri::command]
pub fn scan_default_skills(app: AppHandle) -> Result<Vec<RawSkill>, String> {
    let root = default_skills_root(&app)?;
    scan_default_skills_from_root(&root)
}

pub fn scan_default_skills_from_root(root: &Path) -> Result<Vec<RawSkill>, String> {
    scan_skill_root(root, "default")
}

fn scan_skill_root(root: &Path, source: &str) -> Result<Vec<RawSkill>, String> {
    let mut out: Vec<RawSkill> = Vec::new();
    for provider in PROVIDERS {
        let skills_dir = root.join(format!(".{provider}")).join("skills");
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
                source: source.to_string(),
                dir_name,
                root_dir,
                skill_file,
                skill_file_abs_path: skill_file_path.to_string_lossy().into_owned(),
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

fn default_skills_root(app: &AppHandle) -> Result<PathBuf, String> {
    let resource_root = app
        .path()
        .resource_dir()
        .map_err(|e| format!("failed to resolve app resource directory: {e}"))?
        .join("default-skills");
    if resource_root.is_dir() {
        return Ok(resource_root);
    }

    let dev_root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("default-skills");
    if dev_root.is_dir() {
        return Ok(dev_root);
    }

    Err(format!(
        "default skills directory does not exist: {}",
        resource_root.display()
    ))
}

fn resolve_default_skill_file(root: &Path, skill_file: &str) -> Result<PathBuf, String> {
    let rel = Path::new(skill_file);
    if rel.components().any(|c| {
        matches!(
            c,
            Component::ParentDir | Component::RootDir | Component::Prefix(_)
        )
    }) {
        return Err(format!("invalid default skill path: {skill_file}"));
    }
    let path = root.join(rel);
    if !path.is_file() {
        return Err(format!("default skill not found: {skill_file}"));
    }
    Ok(path)
}

#[tauri::command]
pub fn scan_system_skills() -> Result<Vec<RawSystemSkill>, String> {
    let mut out: Vec<RawSystemSkill> = SYSTEM_SKILL_CATALOG
        .iter()
        .map(|entry| {
            let meta = parse_skill_meta(entry.content, entry.dir_name);
            RawSystemSkill {
                id: entry.id.to_string(),
                provider: entry.provider.to_string(),
                name: meta.name,
                description: meta.description,
                source: "system".to_string(),
            }
        })
        .collect();

    out.sort_by(|a, b| {
        a.provider
            .cmp(&b.provider)
            .then_with(|| a.id.cmp(&b.id))
    });
    Ok(out)
}

#[tauri::command]
pub fn runtime_read_system_skill(system_skill_id: String) -> Result<String, String> {
    SYSTEM_SKILL_CATALOG
        .iter()
        .find(|entry| entry.id == system_skill_id)
        .map(|entry| entry.content.to_string())
        .ok_or_else(|| format!("system skill not found: {system_skill_id}"))
}

#[tauri::command]
pub fn runtime_read_default_skill(app: AppHandle, skill_file: String) -> Result<String, String> {
    let root = default_skills_root(&app)?;
    let path = resolve_default_skill_file(&root, &skill_file)?;
    fs::read_to_string(&path).map_err(|e| format!("failed to read {}: {e}", path.display()))
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

struct SkillMeta {
    name: String,
    description: String,
}

fn parse_skill_meta(content: &str, dir_name: &str) -> SkillMeta {
    let mut name: Option<String> = None;
    let mut description: Option<String> = None;

    if let Some(frontmatter) = extract_frontmatter(content) {
        for line in frontmatter.lines() {
            if let Some((raw_key, raw_value)) = line.split_once(':') {
                let key = raw_key.trim();
                let value = unquote(raw_value.trim());
                if key == "name" {
                    name = Some(value.to_string());
                } else if key == "description" {
                    description = Some(value.to_string());
                }
            }
        }
    }

    SkillMeta {
        name: name.unwrap_or_else(|| dir_name.to_string()),
        description: description.unwrap_or_default(),
    }
}

fn extract_frontmatter(content: &str) -> Option<&str> {
    let rest = content.strip_prefix("---")?;
    let rest = rest.strip_prefix('\n')?;
    let close = rest.find("\n---")?;
    Some(&rest[..close])
}

fn unquote(value: &str) -> &str {
    if value.len() >= 2 {
        let first = value.as_bytes()[0];
        let last = value.as_bytes()[value.len() - 1];
        if (first == b'"' && last == b'"') || (first == b'\'' && last == b'\'') {
            return &value[1..value.len() - 1];
        }
    }
    value
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


    #[test]
    fn scan_default_skills_returns_installable_skill_files() {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("default-skills");
        let skills = scan_default_skills_from_root(&root).expect("scan failed");

        assert_eq!(skills.len(), 9);
        let planning = skills
            .iter()
            .find(|s| s.skill_file == ".codex/skills/planning/SKILL.md")
            .unwrap();
        assert_eq!(planning.provider, "codex");
        assert_eq!(planning.source, "default");
        assert!(planning.content.contains("argument-hint"));
        assert!(planning.skill_file_abs_path.ends_with("planning/SKILL.md"));

        let loop_limit = skills
            .iter()
            .find(|s| s.skill_file == ".codex/skills/loop-limit/SKILL.md")
            .unwrap();
        assert_eq!(loop_limit.provider, "codex");
        assert_eq!(loop_limit.source, "default");
        assert!(loop_limit.content.contains("argument-hint: <max-iterations>"));
        assert!(loop_limit.skill_file_abs_path.ends_with("loop-limit/SKILL.md"));

        let wrap_up = skills
            .iter()
            .find(|s| s.skill_file == ".codex/skills/wrap-up/SKILL.md")
            .unwrap();
        assert_eq!(wrap_up.provider, "codex");
        assert_eq!(wrap_up.source, "default");
        assert!(wrap_up.skill_file_abs_path.ends_with("wrap-up/SKILL.md"));

        let review_and_fix = skills
            .iter()
            .find(|s| s.skill_file == ".claude/skills/review-and-fix/SKILL.md")
            .unwrap();
        assert_eq!(review_and_fix.provider, "claude");
        assert_eq!(review_and_fix.source, "default");
        assert!(review_and_fix
            .skill_file_abs_path
            .ends_with("review-and-fix/SKILL.md"));

        let claude_wrap_up = skills
            .iter()
            .find(|s| s.skill_file == ".claude/skills/wrap-up/SKILL.md")
            .unwrap();
        assert_eq!(claude_wrap_up.provider, "claude");
        assert_eq!(claude_wrap_up.source, "default");
        assert!(claude_wrap_up
            .skill_file_abs_path
            .ends_with("wrap-up/SKILL.md"));
    }

    #[test]
    fn scan_system_skills_returns_internal_catalog_metadata() {
        let skills = scan_system_skills().expect("scan failed");

        assert_eq!(skills.len(), 6);
        let imagegen = skills.iter().find(|s| s.id == "codex:imagegen").unwrap();
        assert_eq!(imagegen.provider, "codex");
        assert_eq!(imagegen.name, "imagegen");
        assert_eq!(
            imagegen.description,
            "Generate or edit raster images from prompt or reference assets."
        );
        assert_eq!(imagegen.source, "system");

        let boarding = skills
            .iter()
            .find(|s| s.id == "codex:starter/boarding")
            .unwrap();
        assert_eq!(boarding.name, "planning");
        assert_eq!(boarding.source, "system");

        let taxiing = skills
            .iter()
            .find(|s| s.id == "claude:starter/taxiing")
            .unwrap();
        assert_eq!(taxiing.provider, "claude");
        assert_eq!(taxiing.name, "implement-plan");

        let review = skills
            .iter()
            .find(|s| s.id == "codex:starter/review-and-fix")
            .unwrap();
        assert_eq!(review.provider, "codex");
        assert_eq!(review.name, "review-changes");

        let takeoff = skills
            .iter()
            .find(|s| s.id == "claude:starter/takeoff")
            .unwrap();
        assert_eq!(takeoff.provider, "claude");
        assert_eq!(takeoff.name, "publish-pr");

        let landing = skills
            .iter()
            .find(|s| s.id == "claude:starter/landing")
            .unwrap();
        assert_eq!(landing.provider, "claude");
        assert_eq!(landing.name, "cleanup-merged-pr");
    }

    #[test]
    fn runtime_read_system_skill_returns_bundled_content_by_id() {
        let content = runtime_read_system_skill("codex:starter/boarding".into())
            .expect("system skill should exist");
        assert!(content.contains("# planning"));

        let missing = runtime_read_system_skill("codex:starter/missing".into());
        assert!(missing.is_err());
    }
}
