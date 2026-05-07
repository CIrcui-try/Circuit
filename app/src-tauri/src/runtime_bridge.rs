use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{Arc, Mutex};

use serde::Serialize;
use tauri::ipc::Channel;
use tauri::State;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{ChildStdin, Command};
use tokio::sync::{oneshot, Mutex as AsyncMutex};

const MAX_READ_BYTES: u64 = 1024 * 1024;

struct RunHandle {
    cancel: Option<oneshot::Sender<()>>,
    stdin: Arc<AsyncMutex<Option<ChildStdin>>>,
}

type RunRegistry = Arc<Mutex<HashMap<String, RunHandle>>>;

#[derive(Default)]
pub struct RuntimeBridgeState {
    inner: RunRegistry,
}

impl RuntimeBridgeState {
    fn register(
        &self,
        run_id: String,
        cancel_tx: oneshot::Sender<()>,
        stdin: Arc<AsyncMutex<Option<ChildStdin>>>,
    ) {
        let mut map = self.inner.lock().expect("runtime bridge state poisoned");
        map.insert(
            run_id,
            RunHandle {
                cancel: Some(cancel_tx),
                stdin,
            },
        );
    }

    fn take_cancel(&self, run_id: &str) -> Option<oneshot::Sender<()>> {
        let mut map = self.inner.lock().expect("runtime bridge state poisoned");
        map.get_mut(run_id).and_then(|h| h.cancel.take())
    }

    fn stdin_for(&self, run_id: &str) -> Option<Arc<AsyncMutex<Option<ChildStdin>>>> {
        let map = self.inner.lock().expect("runtime bridge state poisoned");
        map.get(run_id).map(|h| Arc::clone(&h.stdin))
    }

    fn inner_arc(&self) -> RunRegistry {
        Arc::clone(&self.inner)
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum RuntimeProcessEvent {
    Started {
        run_id: String,
        timestamp: String,
    },
    Stdout {
        run_id: String,
        timestamp: String,
        text: String,
    },
    Stderr {
        run_id: String,
        timestamp: String,
        text: String,
    },
    Exited {
        run_id: String,
        timestamp: String,
        exit_code: Option<i32>,
    },
    Cancelled {
        run_id: String,
        timestamp: String,
    },
    Timeout {
        run_id: String,
        timestamp: String,
    },
    Error {
        run_id: String,
        timestamp: String,
        message: String,
    },
}

fn now_iso8601() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let dur = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default();
    let secs = dur.as_secs();
    let millis = dur.subsec_millis();
    let days_since_epoch = secs / 86_400;
    let secs_of_day = secs % 86_400;
    let hour = secs_of_day / 3600;
    let minute = (secs_of_day % 3600) / 60;
    let second = secs_of_day % 60;
    let (year, month, day) = days_to_ymd(days_since_epoch as i64);
    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}.{:03}Z",
        year, month, day, hour, minute, second, millis
    )
}

fn days_to_ymd(mut days: i64) -> (i32, u32, u32) {
    days += 719_468;
    let era = if days >= 0 { days } else { days - 146_096 } / 146_097;
    let doe = (days - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = (y + if m <= 2 { 1 } else { 0 }) as i32;
    (year, m as u32, d as u32)
}

fn validate_inside_repo_root(target: &Path, repo_root: &Path) -> Result<PathBuf, String> {
    let target_abs = target
        .canonicalize()
        .map_err(|e| format!("failed to canonicalize {}: {e}", target.display()))?;
    let root_abs = repo_root
        .canonicalize()
        .map_err(|e| format!("failed to canonicalize repo root {}: {e}", repo_root.display()))?;
    if !target_abs.starts_with(&root_abs) {
        return Err(format!(
            "path is outside repository root: path={} repoRoot={}",
            target_abs.display(),
            root_abs.display()
        ));
    }
    Ok(target_abs)
}

#[tauri::command]
pub fn runtime_read_file(path: String, repo_root: String) -> Result<String, String> {
    let target = PathBuf::from(&path);
    let repo = PathBuf::from(&repo_root);
    let resolved = validate_inside_repo_root(&target, &repo)?;
    let metadata = std::fs::metadata(&resolved)
        .map_err(|e| format!("failed to stat {}: {e}", resolved.display()))?;
    if metadata.len() > MAX_READ_BYTES {
        return Err(format!(
            "file too large to read via runtime bridge: {} bytes (max {})",
            metadata.len(),
            MAX_READ_BYTES
        ));
    }
    std::fs::read_to_string(&resolved)
        .map_err(|e| format!("failed to read {}: {e}", resolved.display()))
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn runtime_spawn(
    state: State<'_, RuntimeBridgeState>,
    run_id: String,
    command: String,
    args: Vec<String>,
    cwd: String,
    env: Option<HashMap<String, String>>,
    timeout_ms: Option<u64>,
    on_event: Channel<RuntimeProcessEvent>,
) -> Result<(), String> {
    let cwd_path = PathBuf::from(&cwd);
    let _ = cwd_path
        .canonicalize()
        .map_err(|e| format!("failed to canonicalize cwd {}: {e}", cwd_path.display()))?;

    let mut cmd = Command::new(&command);
    cmd.args(&args)
        .current_dir(&cwd_path)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .stdin(Stdio::piped());
    if let Some(envs) = env {
        for (k, v) in envs {
            cmd.env(k, v);
        }
    }

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("failed to spawn {command}: {e}"))?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "failed to capture stdout".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "failed to capture stderr".to_string())?;
    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| "failed to capture stdin".to_string())?;

    let (cancel_tx, mut cancel_rx) = oneshot::channel::<()>();
    let stdin_slot = Arc::new(AsyncMutex::new(Some(stdin)));
    state.register(run_id.clone(), cancel_tx, Arc::clone(&stdin_slot));

    // Channel<T> is cheap to clone and is safe to share across the spawn task
    // and any post-task cleanup we add later (e.g. ApprovalRequest emit from a
    // sibling helper).
    let event = on_event;
    let _ = event.send(RuntimeProcessEvent::Started {
        run_id: run_id.clone(),
        timestamp: now_iso8601(),
    });

    let state_handle = state.inner_arc();
    let run_id_task = run_id.clone();
    let event_task = event.clone();
    let stdin_for_task = Arc::clone(&stdin_slot);

    tokio::spawn(async move {
        let run_id = run_id_task;
        let event = event_task;
        let stdin_slot = stdin_for_task;
        let mut stdout_reader = BufReader::new(stdout).lines();
        let mut stderr_reader = BufReader::new(stderr).lines();

        let timeout_fut: std::pin::Pin<Box<dyn std::future::Future<Output = ()> + Send>> =
            match timeout_ms {
                Some(ms) => Box::pin(tokio::time::sleep(std::time::Duration::from_millis(ms))),
                None => Box::pin(std::future::pending::<()>()),
            };
        tokio::pin!(timeout_fut);

        let final_event: Option<RuntimeProcessEvent>;
        loop {
            tokio::select! {
                line = stdout_reader.next_line() => match line {
                    Ok(Some(text)) => {
                        let _ = event.send(RuntimeProcessEvent::Stdout {
                            run_id: run_id.clone(),
                            timestamp: now_iso8601(),
                            text,
                        });
                    }
                    Ok(None) => {}
                    Err(e) => {
                        final_event = Some(RuntimeProcessEvent::Error {
                            run_id: run_id.clone(),
                            timestamp: now_iso8601(),
                            message: format!("stdout read error: {e}"),
                        });
                        let _ = child.kill().await;
                        break;
                    }
                },
                line = stderr_reader.next_line() => match line {
                    Ok(Some(text)) => {
                        let _ = event.send(RuntimeProcessEvent::Stderr {
                            run_id: run_id.clone(),
                            timestamp: now_iso8601(),
                            text,
                        });
                    }
                    Ok(None) => {}
                    Err(e) => {
                        final_event = Some(RuntimeProcessEvent::Error {
                            run_id: run_id.clone(),
                            timestamp: now_iso8601(),
                            message: format!("stderr read error: {e}"),
                        });
                        let _ = child.kill().await;
                        break;
                    }
                },
                exit = child.wait() => {
                    match exit {
                        Ok(status) => {
                            final_event = Some(RuntimeProcessEvent::Exited {
                                run_id: run_id.clone(),
                                timestamp: now_iso8601(),
                                exit_code: status.code(),
                            });
                        }
                        Err(e) => {
                            final_event = Some(RuntimeProcessEvent::Error {
                                run_id: run_id.clone(),
                                timestamp: now_iso8601(),
                                message: format!("wait error: {e}"),
                            });
                        }
                    }
                    break;
                },
                _ = &mut timeout_fut => {
                    let _ = child.kill().await;
                    final_event = Some(RuntimeProcessEvent::Timeout {
                        run_id: run_id.clone(),
                        timestamp: now_iso8601(),
                    });
                    break;
                },
                _ = &mut cancel_rx => {
                    let _ = child.kill().await;
                    final_event = Some(RuntimeProcessEvent::Cancelled {
                        run_id: run_id.clone(),
                        timestamp: now_iso8601(),
                    });
                    break;
                },
            }
        }

        // drain remaining lines
        while let Ok(Some(text)) = stdout_reader.next_line().await {
            let _ = event.send(RuntimeProcessEvent::Stdout {
                run_id: run_id.clone(),
                timestamp: now_iso8601(),
                text,
            });
        }
        while let Ok(Some(text)) = stderr_reader.next_line().await {
            let _ = event.send(RuntimeProcessEvent::Stderr {
                run_id: run_id.clone(),
                timestamp: now_iso8601(),
                text,
            });
        }

        if let Some(ev) = final_event {
            let _ = event.send(ev);
        }

        // Close stdin so any in-flight send_input rejects cleanly rather than
        // blocking forever on a dead pipe.
        {
            let mut guard = stdin_slot.lock().await;
            *guard = None;
        }

        let mut map = state_handle.lock().expect("runtime bridge state poisoned");
        map.remove(&run_id);
    });

    Ok(())
}

#[tauri::command]
pub fn runtime_cancel(state: State<'_, RuntimeBridgeState>, run_id: String) -> Result<(), String> {
    if let Some(tx) = state.take_cancel(&run_id) {
        let _ = tx.send(());
    }
    Ok(())
}

#[tauri::command]
pub async fn runtime_send_input(
    state: State<'_, RuntimeBridgeState>,
    run_id: String,
    text: String,
) -> Result<(), String> {
    let stdin_slot = state
        .stdin_for(&run_id)
        .ok_or_else(|| format!("no active run for id {run_id}"))?;
    let mut guard = stdin_slot.lock().await;
    let stdin = guard
        .as_mut()
        .ok_or_else(|| format!("stdin already closed for run {run_id}"))?;
    stdin
        .write_all(text.as_bytes())
        .await
        .map_err(|e| format!("stdin write failed: {e}"))?;
    stdin
        .flush()
        .await
        .map_err(|e| format!("stdin flush failed: {e}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn unique_tmp_dir(tag: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let dir = std::env::temp_dir().join(format!("circuit-runtime-{tag}-{nanos}"));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn read_file_returns_content_inside_repo_root() {
        let repo = unique_tmp_dir("ok");
        let file = repo.join("hello.txt");
        fs::write(&file, "hi").unwrap();
        let got = runtime_read_file(
            file.to_string_lossy().into_owned(),
            repo.to_string_lossy().into_owned(),
        )
        .expect("read should succeed");
        assert_eq!(got, "hi");
    }

    #[test]
    fn read_file_rejects_path_outside_repo_root() {
        let repo = unique_tmp_dir("deny");
        let other_repo = unique_tmp_dir("other");
        let file = other_repo.join("secret.txt");
        fs::write(&file, "shh").unwrap();
        let err = runtime_read_file(
            file.to_string_lossy().into_owned(),
            repo.to_string_lossy().into_owned(),
        )
        .expect_err("read should be rejected");
        assert!(err.contains("outside repository root"), "unexpected: {err}");
    }

    #[test]
    fn read_file_rejects_traversal_escape() {
        let repo = unique_tmp_dir("trav");
        let other_repo = unique_tmp_dir("trav-other");
        let outside = other_repo.join("evil.txt");
        fs::write(&outside, "x").unwrap();
        let traversal = repo.join("..").join(outside.file_name().unwrap());
        let err = runtime_read_file(
            traversal.to_string_lossy().into_owned(),
            repo.to_string_lossy().into_owned(),
        )
        .expect_err("read should be rejected");
        assert!(
            err.contains("outside repository root") || err.contains("failed to canonicalize"),
            "unexpected: {err}"
        );
    }

    #[test]
    fn read_file_rejects_oversized_file() {
        let repo = unique_tmp_dir("big");
        let file = repo.join("big.bin");
        let big = vec![b'a'; (MAX_READ_BYTES + 1) as usize];
        fs::write(&file, &big).unwrap();
        let err = runtime_read_file(
            file.to_string_lossy().into_owned(),
            repo.to_string_lossy().into_owned(),
        )
        .expect_err("oversize read should be rejected");
        assert!(err.contains("too large"), "unexpected: {err}");
    }
}
