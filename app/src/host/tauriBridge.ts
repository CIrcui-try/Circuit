import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-dialog";
import { LazyStore } from "@tauri-apps/plugin-store";
import type {
  HostBridge,
  LayoutPrefsDTO,
  RawSkill,
  RawSystemSkill,
  RunLogEntryDTO,
  WorkflowSummaryDTO,
  WorkspaceDTO,
} from "./bridge";
import type { Repository } from "../stores/repositoryStore";

const STORE_FILE = "repositories.json";
const STORE_KEY = "repositories";
const LAYOUT_KEY = "layout";

const store = new LazyStore(STORE_FILE);

export const tauriHostBridge: HostBridge = {
  async openRepositoryDialog() {
    const selected = await open({ directory: true, multiple: false });
    return typeof selected === "string" ? selected : null;
  },

  async createTutorialRepository() {
    return await invoke<string>("create_tutorial_repository");
  },

  async pathExists(path: string) {
    return await invoke<boolean>("path_exists", { path });
  },

  async scanSkills(repoPath: string) {
    return await invoke<RawSkill[]>("scan_skills", { repoPath });
  },

  async scanDefaultSkills() {
    return await invoke<RawSkill[]>("scan_default_skills");
  },

  async scanSystemSkills() {
    return await invoke<RawSystemSkill[]>("scan_system_skills");
  },

  async loadRepositories() {
    const stored = await store.get<Repository[]>(STORE_KEY);
    return stored ?? null;
  },

  async saveRepositories(repos: Repository[]) {
    await store.set(STORE_KEY, repos);
    await store.save();
  },

  async listWorkflows(repoPath: string) {
    return await invoke<WorkflowSummaryDTO[]>("list_workflows", { repoPath });
  },

  async loadWorkflow(repoPath: string, workflowId: string) {
    return await invoke<string>("load_workflow", { repoPath, workflowId });
  },

  async saveWorkflow(repoPath: string, workflowId: string, json: string) {
    await invoke<void>("save_workflow", { repoPath, workflowId, json });
  },

  async saveRunLog(
    repoPath: string,
    workflowId: string,
    runId: string,
    jsonl: string,
  ) {
    await invoke<void>("save_run_log", {
      repoPath,
      workflowId,
      runId,
      jsonl,
    });
  },

  async listRunLogs(repoPath: string, workflowId: string) {
    return await invoke<RunLogEntryDTO[]>("list_run_logs", {
      repoPath,
      workflowId,
    });
  },

  async loadRunLog(repoPath: string, workflowId: string, runId: string) {
    return await invoke<string>("load_run_log", {
      repoPath,
      workflowId,
      runId,
    });
  },

  async loadLayout() {
    const stored = await store.get<LayoutPrefsDTO>(LAYOUT_KEY);
    return stored ?? null;
  },

  async saveLayout(prefs: LayoutPrefsDTO) {
    await store.set(LAYOUT_KEY, prefs);
    await store.save();
  },

  async acquireWorkspace(userId: string, repoUrl: string) {
    return await invoke<WorkspaceDTO>("acquire_workspace", { userId, repoUrl });
  },

  async releaseToPool(workspaceId: string) {
    await invoke<void>("release_to_pool", { workspaceId });
  },

  async cleanupWorkspace(workspaceId: string) {
    await invoke<void>("cleanup_workspace", { workspaceId });
  },

  async beginTurn(workspaceId: string, turnIndex: number) {
    await invoke<void>("begin_turn", { workspaceId, turnIndex });
  },

  async commitTurn(workspaceId: string) {
    await invoke<void>("commit_turn", { workspaceId });
  },

  async prewarm(userId: string, repoUrl: string, count: number) {
    await invoke<void>("prewarm", { userId, repoUrl, count });
  },

  async setAppIconRunBadge(active: boolean) {
    await getCurrentWindow().setBadgeLabel(active ? " " : undefined);
  },

  async isAppWindowFocused() {
    return await getCurrentWindow().isFocused();
  },

  async onAppWindowFocusChanged(handler: (focused: boolean) => void) {
    return await getCurrentWindow().onFocusChanged(({ payload }) => {
      handler(payload);
    });
  },
};
