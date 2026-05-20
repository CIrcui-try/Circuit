use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_json::Value as JsonValue;
use toml::Value as TomlValue;
use url::Url;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpConfigStatus {
    pub claude: ClaudeMcpConfigStatus,
    pub codex: ProviderMcpConfigStatus,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeMcpConfigStatus {
    pub config: ConfigFileStatus,
    pub auth_cache: ConfigFileStatus,
    pub servers: Vec<McpServerSummary>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderMcpConfigStatus {
    pub config: ConfigFileStatus,
    pub servers: Vec<McpServerSummary>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigFileStatus {
    pub path: String,
    pub ok: bool,
    pub missing: bool,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct McpServerSummary {
    pub provider: String,
    pub scope: String,
    pub project_path: Option<String>,
    pub name: String,
    pub transport: Option<String>,
    pub command: Option<String>,
    pub args: Vec<String>,
    pub url: Option<String>,
    pub has_env: bool,
    pub auth_required: Option<bool>,
}

#[tauri::command]
pub fn read_mcp_config_status() -> McpConfigStatus {
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from(""));
    read_mcp_config_status_from(&home)
}

pub fn read_mcp_config_status_from(home: &Path) -> McpConfigStatus {
    let claude_config_path = home.join(".claude.json");
    let claude_auth_path = home.join(".claude").join("mcp-needs-auth-cache.json");
    let codex_config_path = home.join(".codex").join("config.toml");

    let (auth_cache, auth_required_names) = read_claude_auth_cache(&claude_auth_path);
    let (claude_config, claude_servers) =
        read_claude_config(&claude_config_path, &auth_required_names);
    let (codex_config, codex_servers) = read_codex_config(&codex_config_path);

    McpConfigStatus {
        claude: ClaudeMcpConfigStatus {
            config: claude_config,
            auth_cache,
            servers: claude_servers,
        },
        codex: ProviderMcpConfigStatus {
            config: codex_config,
            servers: codex_servers,
        },
    }
}

fn read_claude_config(
    path: &Path,
    auth_required_names: &BTreeSet<String>,
) -> (ConfigFileStatus, Vec<McpServerSummary>) {
    let bytes = match fs::read_to_string(path) {
        Ok(bytes) => bytes,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
            return (ConfigFileStatus::missing(path), Vec::new())
        }
        Err(err) => {
            return (
                ConfigFileStatus::failed(path, format!("failed to read: {err}")),
                Vec::new(),
            )
        }
    };

    let value: JsonValue = match serde_json::from_str(&bytes) {
        Ok(value) => value,
        Err(err) => {
            return (
                ConfigFileStatus::failed(path, format!("failed to parse JSON: {err}")),
                Vec::new(),
            )
        }
    };

    let mut servers = Vec::new();
    if let Some(global) = value.get("mcpServers").and_then(JsonValue::as_object) {
        for (name, config) in global {
            servers.push(summary_from_json_server(
                "claude",
                "global",
                None,
                name,
                config,
                auth_required_names,
            ));
        }
    }

    if let Some(projects) = value.get("projects").and_then(JsonValue::as_object) {
        for (project_path, project) in projects {
            let Some(project_servers) = project.get("mcpServers").and_then(JsonValue::as_object)
            else {
                continue;
            };
            for (name, config) in project_servers {
                servers.push(summary_from_json_server(
                    "claude",
                    "project",
                    Some(project_path.as_str()),
                    name,
                    config,
                    auth_required_names,
                ));
            }
        }
    }

    (ConfigFileStatus::ok(path), servers)
}

fn read_claude_auth_cache(path: &Path) -> (ConfigFileStatus, BTreeSet<String>) {
    let bytes = match fs::read_to_string(path) {
        Ok(bytes) => bytes,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
            return (ConfigFileStatus::missing(path), BTreeSet::new())
        }
        Err(err) => {
            return (
                ConfigFileStatus::failed(path, format!("failed to read: {err}")),
                BTreeSet::new(),
            )
        }
    };

    let value: JsonValue = match serde_json::from_str(&bytes) {
        Ok(value) => value,
        Err(err) => {
            return (
                ConfigFileStatus::failed(path, format!("failed to parse JSON: {err}")),
                BTreeSet::new(),
            )
        }
    };

    let mut names = BTreeSet::new();
    if let Some(entries) = value.as_object() {
        names.extend(entries.keys().cloned());
    }

    (ConfigFileStatus::ok(path), names)
}

fn read_codex_config(path: &Path) -> (ConfigFileStatus, Vec<McpServerSummary>) {
    let bytes = match fs::read_to_string(path) {
        Ok(bytes) => bytes,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
            return (ConfigFileStatus::missing(path), Vec::new())
        }
        Err(err) => {
            return (
                ConfigFileStatus::failed(path, format!("failed to read: {err}")),
                Vec::new(),
            )
        }
    };

    let value: TomlValue = match toml::from_str(&bytes) {
        Ok(value) => value,
        Err(err) => {
            return (
                ConfigFileStatus::failed(path, format!("failed to parse TOML: {err}")),
                Vec::new(),
            )
        }
    };

    let mut servers = Vec::new();
    if let Some(mcp_servers) = value.get("mcp_servers").and_then(TomlValue::as_table) {
        for (name, config) in mcp_servers {
            servers.push(summary_from_toml_server(name, config));
        }
    }

    (ConfigFileStatus::ok(path), servers)
}

fn summary_from_json_server(
    provider: &str,
    scope: &str,
    project_path: Option<&str>,
    name: &str,
    config: &JsonValue,
    auth_required_names: &BTreeSet<String>,
) -> McpServerSummary {
    let command = config
        .get("command")
        .and_then(JsonValue::as_str)
        .map(str::to_string);
    let args = config
        .get("args")
        .and_then(JsonValue::as_array)
        .map(|values| string_array(values))
        .unwrap_or_default();
    let url = config
        .get("url")
        .and_then(JsonValue::as_str)
        .map(redact_url);
    let transport = config
        .get("type")
        .and_then(JsonValue::as_str)
        .map(str::to_string)
        .or_else(|| infer_transport(command.as_ref(), url.as_ref()));

    McpServerSummary {
        provider: provider.to_string(),
        scope: scope.to_string(),
        project_path: project_path.map(str::to_string),
        name: name.to_string(),
        transport,
        command,
        args,
        url,
        has_env: config.get("env").and_then(JsonValue::as_object).is_some(),
        auth_required: Some(auth_required_names.contains(name)),
    }
}

fn summary_from_toml_server(name: &str, config: &TomlValue) -> McpServerSummary {
    let command = config
        .get("command")
        .and_then(TomlValue::as_str)
        .map(str::to_string);
    let args = config
        .get("args")
        .and_then(TomlValue::as_array)
        .map(|values| toml_string_array(values))
        .unwrap_or_default();
    let url = config.get("url").and_then(TomlValue::as_str).map(redact_url);
    let transport = infer_transport(command.as_ref(), url.as_ref());

    McpServerSummary {
        provider: "codex".to_string(),
        scope: "user".to_string(),
        project_path: None,
        name: name.to_string(),
        transport,
        command,
        args,
        url,
        has_env: config.get("env").and_then(TomlValue::as_table).is_some(),
        auth_required: None,
    }
}

fn string_array(values: &[JsonValue]) -> Vec<String> {
    values
        .iter()
        .filter_map(JsonValue::as_str)
        .map(str::to_string)
        .collect()
}

fn toml_string_array(values: &[TomlValue]) -> Vec<String> {
    values
        .iter()
        .filter_map(TomlValue::as_str)
        .map(str::to_string)
        .collect()
}

fn infer_transport(command: Option<&String>, url: Option<&String>) -> Option<String> {
    if url.is_some() {
        Some("http".to_string())
    } else if command.is_some() {
        Some("stdio".to_string())
    } else {
        None
    }
}

fn redact_url(raw: &str) -> String {
    let Ok(mut url) = Url::parse(raw) else {
        return raw.to_string();
    };

    let _ = url.set_username("");
    let _ = url.set_password(None);
    url.set_query(None);
    url.set_fragment(None);
    url.to_string()
}

impl ConfigFileStatus {
    fn ok(path: &Path) -> Self {
        Self {
            path: path.display().to_string(),
            ok: true,
            missing: false,
            message: None,
        }
    }

    fn missing(path: &Path) -> Self {
        Self {
            path: path.display().to_string(),
            ok: false,
            missing: true,
            message: Some("file not found".to_string()),
        }
    }

    fn failed(path: &Path, message: impl Into<String>) -> Self {
        Self {
            path: path.display().to_string(),
            ok: false,
            missing: false,
            message: Some(message.into()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write(path: &Path, content: &str) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(path, content).unwrap();
    }

    #[test]
    fn parses_claude_global_and_project_mcp_servers() {
        let home = tempfile::tempdir().unwrap();
        write(
            &home.path().join(".claude.json"),
            r#"{
              "mcpServers": {
                "linear-server": {
                  "type": "http",
                  "url": "https://user:pass@mcp.linear.app/mcp?token=abc#frag"
                }
              },
              "projects": {
                "/repo": {
                  "mcpServers": {
                    "local": {
                      "command": "node",
                      "args": ["server.js"],
                      "env": {"TOKEN": "secret"}
                    }
                  }
                }
              }
            }"#,
        );
        write(
            &home
                .path()
                .join(".claude")
                .join("mcp-needs-auth-cache.json"),
            r#"{"linear-server":{"timestamp":1,"id":"mcpsrv_1"}}"#,
        );

        let status = read_mcp_config_status_from(home.path());

        assert!(status.claude.config.ok);
        assert_eq!(status.claude.servers.len(), 2);
        assert_eq!(
            status.claude.servers[0].url.as_deref(),
            Some("https://mcp.linear.app/mcp")
        );
        assert_eq!(status.claude.servers[0].auth_required, Some(true));
        assert_eq!(status.claude.servers[1].scope, "project");
        assert_eq!(status.claude.servers[1].project_path.as_deref(), Some("/repo"));
        assert!(status.claude.servers[1].has_env);
    }

    #[test]
    fn parses_codex_mcp_servers_from_toml() {
        let home = tempfile::tempdir().unwrap();
        write(
            &home.path().join(".codex").join("config.toml"),
            r#"
              [mcp_servers.linear]
              url = "https://user@example.com/mcp?secret=1#top"

              [mcp_servers.local]
              command = "node"
              args = ["server.js"]
              [mcp_servers.local.env]
              TOKEN = "secret"
            "#,
        );

        let status = read_mcp_config_status_from(home.path());

        assert!(status.codex.config.ok);
        assert_eq!(status.codex.servers.len(), 2);
        assert_eq!(status.codex.servers[0].name, "linear");
        assert_eq!(
            status.codex.servers[0].url.as_deref(),
            Some("https://example.com/mcp")
        );
        assert_eq!(status.codex.servers[1].transport.as_deref(), Some("stdio"));
        assert!(status.codex.servers[1].has_env);
    }

    #[test]
    fn reports_missing_files_as_structured_status() {
        let home = tempfile::tempdir().unwrap();

        let status = read_mcp_config_status_from(home.path());

        assert!(status.claude.config.missing);
        assert!(status.claude.auth_cache.missing);
        assert!(status.codex.config.missing);
        assert!(status.claude.servers.is_empty());
        assert!(status.codex.servers.is_empty());
    }

    #[test]
    fn reports_parse_failures_without_panicking() {
        let home = tempfile::tempdir().unwrap();
        write(&home.path().join(".claude.json"), "{");
        write(&home.path().join(".codex").join("config.toml"), "[bad");

        let status = read_mcp_config_status_from(home.path());

        assert!(!status.claude.config.ok);
        assert!(!status.claude.config.missing);
        assert!(status
            .claude
            .config
            .message
            .as_deref()
            .unwrap()
            .contains("failed to parse JSON"));
        assert!(status
            .codex
            .config
            .message
            .as_deref()
            .unwrap()
            .contains("failed to parse TOML"));
    }
}
