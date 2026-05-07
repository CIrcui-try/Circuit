//! Turn-boundary resume fuzz (CIR-31, Phase 3).
//!
//! For each seed: run a deterministic baseline workflow, then run an identical
//! workflow that crashes mid-turn at a seed-chosen turn, recovers, and finishes
//! the remaining turns. The two final working trees must hash identically —
//! that's the "무작위 시점 강제 종료 → resume → baseline 동일성" acceptance
//! criterion.

use app_lib::workspace::{
    git_ops::init_repo_with_initial_commit, WorkspaceManager, WorkspaceState, WorkspaceStore,
};
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::path::Path;
use std::time::Duration;
use tempfile::TempDir;
use tokio::fs;

const TURNS: u64 = 5;
const SEEDS: &[u64] = &[1, 7, 42, 1234, 99999];

struct Harness {
    _src: TempDir,
    _ws_root: TempDir,
    _store_dir: TempDir,
    mgr: WorkspaceManager,
    repo_url: String,
}

async fn build() -> Harness {
    let src = TempDir::new().unwrap();
    init_repo_with_initial_commit(src.path()).await.unwrap();
    let store_dir = TempDir::new().unwrap();
    let ws_root = TempDir::new().unwrap();
    let store = WorkspaceStore::open(store_dir.path()).await.unwrap();
    let mgr = WorkspaceManager::new(ws_root.path(), store, Duration::from_secs(60))
        .await
        .unwrap();
    let repo_url = format!("file://{}", src.path().display());
    Harness {
        _src: src,
        _ws_root: ws_root,
        _store_dir: store_dir,
        mgr,
        repo_url,
    }
}

/// Deterministic per-(seed, turn) payload. The exact bytes don't matter — only
/// that baseline and chaotic runs derive the same content from the same inputs.
fn payload(seed: u64, turn: u64) -> Vec<u8> {
    let mut buf = Vec::with_capacity(64);
    for i in 0..16 {
        let byte = ((seed.wrapping_mul(1103515245).wrapping_add(turn).wrapping_add(i)) & 0xff) as u8;
        buf.push(byte);
    }
    buf
}

/// Apply turn `turn` to the working tree: write `turn-<n>.txt` and update the
/// rolling `summary.txt` so each turn's effect depends on prior turns.
async fn apply_turn(path: &Path, seed: u64, turn: u64) {
    fs::write(path.join(format!("turn-{turn}.txt")), payload(seed, turn))
        .await
        .unwrap();
    let summary_path = path.join("summary.txt");
    let mut summary = match fs::read(&summary_path).await {
        Ok(b) => b,
        Err(_) => Vec::new(),
    };
    summary.extend_from_slice(format!("seed={seed} turn={turn}\n").as_bytes());
    fs::write(&summary_path, summary).await.unwrap();
}

/// Hash every non-`.git` file under `path` (sorted) into a single fingerprint
/// — used to compare baseline and post-recovery working trees byte-for-byte.
fn snapshot_hash(path: &Path) -> u64 {
    let mut entries: Vec<_> = walkdir(path)
        .into_iter()
        .filter(|p| {
            !p.components().any(|c| {
                matches!(c, std::path::Component::Normal(name) if name == std::ffi::OsStr::new(".git"))
            })
        })
        .collect();
    entries.sort();

    let mut hasher = DefaultHasher::new();
    for abs in &entries {
        let rel = abs.strip_prefix(path).unwrap();
        rel.to_string_lossy().hash(&mut hasher);
        let bytes = std::fs::read(abs).unwrap();
        bytes.hash(&mut hasher);
    }
    hasher.finish()
}

fn walkdir(root: &Path) -> Vec<std::path::PathBuf> {
    let mut out = Vec::new();
    let mut stack = vec![root.to_path_buf()];
    while let Some(d) = stack.pop() {
        let rd = match std::fs::read_dir(&d) {
            Ok(r) => r,
            Err(_) => continue,
        };
        for entry in rd.flatten() {
            let p = entry.path();
            if p.is_dir() {
                stack.push(p);
            } else {
                out.push(p);
            }
        }
    }
    out
}

/// Choose the turn at which to crash for `seed`. Uses turn 1..=TURNS (avoid 0
/// so there's always at least one settled turn before the crash).
fn crash_turn_for(seed: u64) -> u64 {
    1 + seed % TURNS
}

async fn run_baseline(seed: u64) -> u64 {
    let h = build().await;
    let ws = h.mgr.acquire("alice", &h.repo_url).await.unwrap();
    for turn in 1..=TURNS {
        h.mgr.begin_turn(&ws, turn).await.unwrap();
        apply_turn(&ws.path, seed, turn).await;
        h.mgr.commit_turn(&ws).await.unwrap();
    }
    let hash = snapshot_hash(&ws.path);
    ws.release().await.unwrap();
    hash
}

async fn run_with_crash(seed: u64) -> u64 {
    let h = build().await;
    let ws = h.mgr.acquire("alice", &h.repo_url).await.unwrap();
    let id = ws.id.clone();
    let crash_turn = crash_turn_for(seed);

    // Settle turns up to but not including crash_turn.
    for turn in 1..crash_turn {
        h.mgr.begin_turn(&ws, turn).await.unwrap();
        apply_turn(&ws.path, seed, turn).await;
        h.mgr.commit_turn(&ws).await.unwrap();
    }

    // Begin crash_turn, write its dirty payload, then "crash" without committing.
    h.mgr.begin_turn(&ws, crash_turn).await.unwrap();
    apply_turn(&ws.path, seed, crash_turn).await;
    // Drop in-memory state, leave disk + Store + action log.
    ws.release().await.unwrap();
    drop(ws);
    h.mgr.unregister(&id).await;

    // Recover: must roll back the in-flight crash_turn so we restart from it.
    let recovered = h.mgr.recover(&id).await.unwrap();
    assert_eq!(recovered.state().await, WorkspaceState::Idle);
    assert!(recovered.active_turn().await.is_none());
    recovered.attach().await.unwrap();

    // Finish crash_turn..=TURNS afresh.
    for turn in crash_turn..=TURNS {
        h.mgr.begin_turn(&recovered, turn).await.unwrap();
        apply_turn(&recovered.path, seed, turn).await;
        h.mgr.commit_turn(&recovered).await.unwrap();
    }

    let hash = snapshot_hash(&recovered.path);
    recovered.release().await.unwrap();
    hash
}

#[tokio::test]
async fn baseline_hash_is_stable_across_runs() {
    // Same seed twice must produce the same fingerprint — guards the harness
    // itself before we use it to assert recovery equivalence.
    let a = run_baseline(42).await;
    let b = run_baseline(42).await;
    assert_eq!(a, b);
}

#[tokio::test]
async fn random_kill_then_recover_matches_baseline_for_each_seed() {
    for &seed in SEEDS {
        let baseline = run_baseline(seed).await;
        let recovered = run_with_crash(seed).await;
        assert_eq!(
            recovered, baseline,
            "seed={seed} crash_turn={} produced divergent fingerprint",
            crash_turn_for(seed)
        );
    }
}
