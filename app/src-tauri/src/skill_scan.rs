use std::fs;
use std::path::{Component, Path, PathBuf};

use serde::Serialize;
use tauri::{AppHandle, Manager};

#[derive(Debug, Serialize)]
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
    let repo = resolve_repo_path(&repo_path)?;

    scan_skill_root(&repo, "repository")
}

#[tauri::command]
pub fn create_repository_skill(
    repo_path: String,
    provider: String,
    slug: String,
    name: String,
    description: String,
    default_arguments: Option<String>,
    default_prompt: Option<String>,
    default_model: Option<String>,
) -> Result<RawSkill, String> {
    let repo = resolve_repo_path(&repo_path)?;
    let provider = validate_provider(&provider)?;
    let slug = validate_slug(&slug)?;
    let name = validate_required_text(&name, "skill name")?;
    let description = normalize_description(&description);
    let default_arguments = normalize_optional_frontmatter_text(default_arguments);
    let default_prompt = normalize_optional_frontmatter_text(default_prompt);
    let default_model = normalize_optional_frontmatter_text(default_model);

    let provider_root = repo.join(format!(".{provider}"));
    ensure_existing_path_inside_repo(&repo, &provider_root)?;
    let skills_dir = provider_root.join("skills");
    ensure_existing_path_inside_repo(&repo, &skills_dir)?;

    let skill_dir = skills_dir.join(&slug);
    if skill_dir.exists() {
        return Err(format!("skill already exists: .{provider}/skills/{slug}"));
    }

    fs::create_dir_all(&skills_dir)
        .map_err(|e| format!("failed to create {}: {e}", skills_dir.display()))?;
    ensure_existing_path_inside_repo(&repo, &skills_dir)?;

    fs::create_dir(&skill_dir)
        .map_err(|e| format!("failed to create {}: {e}", skill_dir.display()))?;

    let skill_file_path = skill_dir.join("SKILL.md");
    let content = render_skill_template(
        &name,
        &description,
        default_arguments.as_deref(),
        default_prompt.as_deref(),
        default_model.as_deref(),
    );
    fs::write(&skill_file_path, content)
        .map_err(|e| format!("failed to write {}: {e}", skill_file_path.display()))?;

    read_skill_dir(provider, "repository", &skill_dir)?
        .ok_or_else(|| format!("failed to read created skill: {}", skill_dir.display()))
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
            if let Some(skill) = read_skill_dir(provider, source, &path)? {
                out.push(skill);
            }
        }
    }

    out.sort_by(|a, b| {
        a.provider
            .cmp(&b.provider)
            .then_with(|| a.dir_name.cmp(&b.dir_name))
    });
    Ok(out)
}

fn resolve_repo_path(repo_path: &str) -> Result<PathBuf, String> {
    let repo = PathBuf::from(repo_path);
    if !repo.is_dir() {
        return Err("repository path does not exist".into());
    }
    repo.canonicalize()
        .map_err(|e| format!("failed to resolve repository path: {e}"))
}

fn validate_provider(provider: &str) -> Result<&'static str, String> {
    PROVIDERS
        .iter()
        .copied()
        .find(|candidate| *candidate == provider)
        .ok_or_else(|| "provider must be claude or codex".to_string())
}

fn validate_slug(slug: &str) -> Result<String, String> {
    let slug = slug.trim();
    if slug.is_empty() {
        return Err("skill slug is required".into());
    }
    if !slug
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err("skill slug may only contain letters, numbers, hyphens, or underscores".into());
    }
    Ok(slug.to_string())
}

fn validate_required_text(value: &str, label: &str) -> Result<String, String> {
    let value = value.trim();
    if value.is_empty() {
        return Err(format!("{label} is required"));
    }
    if value.lines().count() > 1 {
        return Err(format!("{label} must be a single line"));
    }
    Ok(value.to_string())
}

fn normalize_description(description: &str) -> String {
    description
        .trim()
        .lines()
        .map(str::trim)
        .collect::<Vec<_>>()
        .join(" ")
}

fn normalize_optional_frontmatter_text(value: Option<String>) -> Option<String> {
    value
        .map(|v| normalize_description(&v))
        .filter(|v| !v.is_empty())
}

fn ensure_existing_path_inside_repo(repo: &Path, path: &Path) -> Result<(), String> {
    if !path.exists() {
        return Ok(());
    }
    let resolved = path
        .canonicalize()
        .map_err(|e| format!("failed to resolve {}: {e}", path.display()))?;
    if !resolved.starts_with(repo) {
        return Err(format!("path escapes repository root: {}", path.display()));
    }
    Ok(())
}

fn render_skill_template(
    name: &str,
    description: &str,
    default_arguments: Option<&str>,
    default_prompt: Option<&str>,
    default_model: Option<&str>,
) -> String {
    let mut frontmatter = format!(
        "---\nname: \"{}\"\ndescription: \"{}\"\n",
        escape_frontmatter_value(name),
        escape_frontmatter_value(description),
    );
    if let Some(value) = default_arguments {
        frontmatter.push_str(&format!(
            "default-arguments: \"{}\"\n",
            escape_frontmatter_value(value),
        ));
    }
    if let Some(value) = default_prompt {
        frontmatter.push_str(&format!(
            "default-prompt: \"{}\"\n",
            escape_frontmatter_value(value),
        ));
    }
    if let Some(value) = default_model {
        frontmatter.push_str(&format!(
            "default-model: \"{}\"\n",
            escape_frontmatter_value(value),
        ));
    }
    format!("{frontmatter}---\n\n# {name}\n\n{description}\n")
}

fn escape_frontmatter_value(value: &str) -> String {
    value.replace('\\', "\\\\").replace('"', "\\\"")
}

fn read_skill_dir(provider: &str, source: &str, path: &Path) -> Result<Option<RawSkill>, String> {
    let dir_name = match path.file_name().and_then(|s| s.to_str()) {
        Some(s) => s.to_string(),
        None => return Ok(None),
    };
    let (skill_file_name, skill_file_path) = match resolve_skill_file(path) {
        Some(v) => v,
        None => return Ok(None),
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

    Ok(Some(RawSkill {
        provider: provider.to_string(),
        source: source.to_string(),
        dir_name,
        root_dir,
        skill_file,
        skill_file_abs_path: skill_file_path.to_string_lossy().into_owned(),
        content,
    }))
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
    fn create_repository_skill_writes_template_and_scan_finds_it() {
        let tmp = tempfile::tempdir().unwrap();
        let repo = tmp.path().to_string_lossy().into_owned();

        let created = create_repository_skill(
            repo.clone(),
            "codex".into(),
            "new-skill".into(),
            "New Skill".into(),
            "Creates a local skill file.".into(),
            Some("CIR-94 --force".into()),
            Some("Review the implementation.".into()),
            Some("gpt-5.4".into()),
        )
        .expect("create skill failed");

        assert_eq!(created.provider, "codex");
        assert_eq!(created.source, "repository");
        assert_eq!(created.dir_name, "new-skill");
        assert_eq!(created.root_dir, ".codex/skills/new-skill");
        assert_eq!(created.skill_file, ".codex/skills/new-skill/SKILL.md");
        assert!(created.content.contains("name: \"New Skill\""));
        assert!(created
            .content
            .contains("description: \"Creates a local skill file.\""));
        assert!(created
            .content
            .contains("default-arguments: \"CIR-94 --force\""));
        assert!(created
            .content
            .contains("default-prompt: \"Review the implementation.\""));
        assert!(created.content.contains("default-model: \"gpt-5.4\""));

        let skill_file = tmp
            .path()
            .join(".codex")
            .join("skills")
            .join("new-skill")
            .join("SKILL.md");
        assert!(skill_file.is_file());

        let scanned = scan_skills(repo).expect("scan failed");
        assert_eq!(scanned.len(), 1);
        assert_eq!(scanned[0].skill_file, ".codex/skills/new-skill/SKILL.md");
    }

    #[test]
    fn create_repository_skill_rejects_invalid_input() {
        let tmp = tempfile::tempdir().unwrap();
        let repo = tmp.path().to_string_lossy().into_owned();

        let invalid_provider = create_repository_skill(
            repo.clone(),
            "openai".into(),
            "new-skill".into(),
            "New Skill".into(),
            "".into(),
            None,
            None,
            None,
        );
        assert!(invalid_provider
            .unwrap_err()
            .contains("provider must be claude or codex"));

        let empty_slug = create_repository_skill(
            repo.clone(),
            "claude".into(),
            " ".into(),
            "New Skill".into(),
            "".into(),
            None,
            None,
            None,
        );
        assert!(empty_slug.unwrap_err().contains("skill slug is required"));

        let traversal_slug = create_repository_skill(
            repo.clone(),
            "claude".into(),
            "../escape".into(),
            "New Skill".into(),
            "".into(),
            None,
            None,
            None,
        );
        assert!(traversal_slug.unwrap_err().contains("skill slug may only"));

        let empty_name = create_repository_skill(
            repo.clone(),
            "claude".into(),
            "new-skill".into(),
            " ".into(),
            "".into(),
            None,
            None,
            None,
        );
        assert!(empty_name.unwrap_err().contains("skill name is required"));

        let multiline_name = create_repository_skill(
            repo,
            "claude".into(),
            "new-skill".into(),
            "New\nSkill".into(),
            "".into(),
            None,
            None,
            None,
        );
        assert!(multiline_name
            .unwrap_err()
            .contains("skill name must be a single line"));
    }

    #[test]
    fn create_repository_skill_rejects_duplicate_slug() {
        let tmp = tempfile::tempdir().unwrap();
        let repo = tmp.path().to_string_lossy().into_owned();

        create_repository_skill(
            repo.clone(),
            "claude".into(),
            "new-skill".into(),
            "New Skill".into(),
            "".into(),
            None,
            None,
            None,
        )
        .expect("initial create failed");

        let duplicate = create_repository_skill(
            repo,
            "claude".into(),
            "new-skill".into(),
            "New Skill".into(),
            "".into(),
            None,
            None,
            None,
        );
        assert!(duplicate.unwrap_err().contains("skill already exists"));
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
