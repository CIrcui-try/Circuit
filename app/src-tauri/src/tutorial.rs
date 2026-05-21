use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use tauri::{AppHandle, Manager};

const TUTORIAL_DIR_NAME: &str = "Circuit Tutorial";
const README: &str = r#"# Circuit Tutorial

This folder is a safe place to try Circuit. Open it in Circuit and run a starter flow for the task you want to build.

## Example workflows

- `Ticket loop tutorial`: creates `project.md`, works through `tickets/*.md` one ticket at a time, and stops the loop when every ticket is complete.
"#;

const TICKET_LOOP_WORKFLOW: &str =
    include_str!("../../../fixtures/workflows/tutorial-ticket-loop.json");

const TUTORIAL_SKILL_FILES: [(&str, &str); 6] = [
    (
        ".codex/skills/create-project-plan/SKILL.md",
        r#"---
name: create-project-plan
description: Create or refresh project.md and ticket markdown files for the tutorial.
argument-hint: <project request>
---

# create-project-plan

Turn `$ARGUMENTS` into a small local project plan.

Work in the selected tutorial repository.

- If `project.md` already exists, preserve user edits and only add clearly missing structure.
- Ensure `tickets/` exists.
- Create three small `tickets/*.md` files if there are no ticket files yet.
- In `project.md`, list each ticket with a checkbox and its relative path.
- Keep tickets intentionally small enough for one loop iteration.
- End with `CIRCUIT_SUMMARY: project plan ready`.
"#,
    ),
    (
        ".codex/skills/pick-next-ticket/SKILL.md",
        r#"---
name: pick-next-ticket
description: Select the next unfinished ticket or complete the workflow loop.
---

# pick-next-ticket

Read `project.md` and choose the first unfinished ticket.

- Treat unchecked items in `project.md` as unfinished.
- Write the selected ticket path to `.circuit/current-ticket.md`.
- If every ticket is complete, do not modify tickets.
- When every ticket is complete, finish successfully and make the final summary line exactly:

```text
CIRCUIT_SUMMARY: CIRCUIT_LOOP_COMPLETE
```

Circuit treats that summary as a normal successful loop completion.

When a ticket is selected, end with `CIRCUIT_SUMMARY: selected <ticket-path>`.
"#,
    ),
    (
        ".codex/skills/plan-ticket/SKILL.md",
        r#"---
name: plan-ticket
description: Add an implementation and test plan to the selected ticket.
---

# plan-ticket

Read `.circuit/current-ticket.md`, then update that ticket.

- Add or refresh a `## Plan` section.
- Add or refresh a `## Tests` section.
- Keep the plan focused on the current ticket only.
- Do not implement the ticket in this step.
- End with `CIRCUIT_SUMMARY: ticket plan ready`.
"#,
    ),
    (
        ".claude/skills/implement-ticket-plan/SKILL.md",
        r#"---
name: implement-ticket-plan
description: Implement the selected ticket plan and add tests.
---

# implement-ticket-plan

Read `.circuit/current-ticket.md`, then implement the selected ticket.

- Follow the ticket's `## Plan` section.
- Add or update tests described in the ticket's `## Tests` section.
- Keep changes limited to the selected ticket.
- Do not mark the ticket complete.
- End with `CIRCUIT_SUMMARY: implementation ready for review`.
"#,
    ),
    (
        ".codex/skills/review-major-issues/SKILL.md",
        r#"---
name: review-major-issues
description: Review the selected ticket implementation and fix major issues only.
---

# review-major-issues

Review the current local changes for the selected ticket.

- Focus on correctness, data loss, broken tests, and behavior regressions.
- Fix major issues directly.
- Leave minor style preferences alone.
- If no major issue exists, do not churn files.
- End with `CIRCUIT_SUMMARY: major review complete`.
"#,
    ),
    (
        ".codex/skills/verify-tests/SKILL.md",
        r#"---
name: verify-tests
description: Run tests, verify the selected ticket, and mark it complete.
---

# verify-tests

Read `.circuit/current-ticket.md`, run the relevant tests, and verify the selected ticket.

- If tests pass and the ticket is complete, mark the ticket done in `project.md`.
- Add a short verification note to the ticket.
- If verification fails, report the blocker clearly and do not mark the ticket complete.
- End with `CIRCUIT_SUMMARY: ticket verified`.
"#,
    ),
];

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

    ensure_tutorial_examples(&path)?;
    ensure_git_repository(&path)?;

    Ok(path)
}

fn ensure_tutorial_examples(path: &Path) -> Result<(), String> {
    for (relative_path, content) in TUTORIAL_SKILL_FILES {
        write_if_missing(path, relative_path, content)?;
    }
    write_if_missing(
        path,
        ".circuit/workflows/tutorial-ticket-loop.json",
        TICKET_LOOP_WORKFLOW,
    )
}

fn write_if_missing(root: &Path, relative_path: &str, content: &str) -> Result<(), String> {
    let path = root.join(relative_path);
    if path.exists() {
        return Ok(());
    }
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("failed to create {}: {e}", parent.display()))?;
    }
    fs::write(&path, content).map_err(|e| format!("failed to write {}: {e}", path.display()))
}

fn ensure_git_repository(path: &Path) -> Result<(), String> {
    if !path.join(".git").is_dir() {
        run_git(path, &["init"])?;
    }

    run_git(path, &["config", "user.name", "Circuit Tutorial"])?;
    run_git(path, &["config", "user.email", "tutorial@circuit.local"])?;

    if !git_head_exists(path)? {
        run_git(path, &["add", "."])?;
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
        assert!(path
            .join(".codex")
            .join("skills")
            .join("pick-next-ticket")
            .join("SKILL.md")
            .is_file());
        assert!(path
            .join(".claude")
            .join("skills")
            .join("implement-ticket-plan")
            .join("SKILL.md")
            .is_file());
        assert!(path
            .join(".circuit")
            .join("workflows")
            .join("tutorial-ticket-loop.json")
            .is_file());
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
    fn preserves_existing_tutorial_example_files() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(TUTORIAL_DIR_NAME);
        let skill_path = path
            .join(".codex")
            .join("skills")
            .join("pick-next-ticket")
            .join("SKILL.md");
        let workflow_path = path
            .join(".circuit")
            .join("workflows")
            .join("tutorial-ticket-loop.json");
        fs::create_dir_all(skill_path.parent().unwrap()).unwrap();
        fs::create_dir_all(workflow_path.parent().unwrap()).unwrap();
        fs::write(&skill_path, "custom skill").unwrap();
        fs::write(&workflow_path, "custom workflow").unwrap();

        create_tutorial_repository_at(dir.path()).unwrap();

        assert_eq!(fs::read_to_string(skill_path).unwrap(), "custom skill");
        assert_eq!(fs::read_to_string(workflow_path).unwrap(), "custom workflow");
    }

    #[test]
    fn repairs_existing_folder_without_git() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(TUTORIAL_DIR_NAME);
        fs::create_dir_all(&path).unwrap();

        create_tutorial_repository_at(dir.path()).unwrap();

        assert!(path.join(".git").is_dir());
        assert!(path
            .join(".circuit")
            .join("workflows")
            .join("tutorial-ticket-loop.json")
            .is_file());
        assert!(git_head_exists(&path).unwrap());
    }
}
