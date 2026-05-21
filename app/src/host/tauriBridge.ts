import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open, save } from "@tauri-apps/plugin-dialog";
import {
  isPermissionGranted,
  onAction,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import { LazyStore } from "@tauri-apps/plugin-store";
import type {
  HostBridge,
  CliSettingsDTO,
  LayoutPrefsDTO,
  McpConfigStatus,
  RawSkill,
  RawSystemSkill,
  RepositoryEnvironmentCheck,
  RunLogEntryDTO,
  WorkflowBundleExportDTO,
  WorkflowBundleImportPreviewDTO,
  WorkflowBundleImportResultDTO,
  WorkflowBundleSkillResolutionDTO,
  WorkflowSummaryDTO,
  WorkspaceDTO,
} from "./bridge";
import type { Repository } from "../stores/repositoryStore";

const STORE_FILE = "repositories.json";
const PREFERENCES_FILE = "preferences.json";
const STORE_KEY = "repositories";
const LAYOUT_KEY = "layout";
const CLI_SETTINGS_KEY = "cliSettings";

const store = new LazyStore(STORE_FILE);
const preferencesStore = new LazyStore(PREFERENCES_FILE);

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

  async checkRepositoryEnvironment(repoPath: string) {
    return await invoke<RepositoryEnvironmentCheck>("check_repository_environment", {
      repoPath,
    });
  },

  async readMcpConfigStatus() {
    return await invoke<McpConfigStatus>("read_mcp_config_status");
  },

  async scanSkills(repoPath: string) {
    return await invoke<RawSkill[]>("scan_skills", { repoPath });
  },

  async createRepositorySkill(repoPath, input) {
    return await invoke<RawSkill>("create_repository_skill", {
      repoPath,
      ...input,
    });
  },

  async deleteRepositorySkill(repoPath, input) {
    await invoke<void>("delete_repository_skill", {
      repoPath,
      ...input,
    });
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

  async deleteWorkflow(repoPath: string, workflowId: string) {
    await invoke<void>("delete_workflow", { repoPath, workflowId });
  },

  async exportWorkflowBundle(repoPath, workflowJson, suggestedFileName) {
    const selected = await save({
      defaultPath: suggestedFileName.endsWith(".circuitflow")
        ? suggestedFileName
        : `${suggestedFileName}.circuitflow`,
      filters: [{ name: "Circuit workflow bundle", extensions: ["circuitflow"] }],
    });
    if (!selected) return null;
    return await invoke<WorkflowBundleExportDTO>("export_workflow_bundle", {
      repoPath,
      workflowJson,
      exportedAt: new Date().toISOString(),
      exportPath: selected,
    });
  },

  async previewWorkflowBundleImport(repoPath) {
    const selected = await open({
      directory: false,
      multiple: false,
      filters: [{ name: "Circuit workflow bundle", extensions: ["circuitflow"] }],
    });
    if (typeof selected !== "string") return null;
    return await invoke<WorkflowBundleImportPreviewDTO>(
      "preview_workflow_bundle_import",
      {
        repoPath,
        bundlePath: selected,
      },
    );
  },

  async importWorkflowBundle(
    repoPath: string,
    repositoryId: string,
    bundlePath: string,
    workflowId: string,
    now: string,
    resolutions: WorkflowBundleSkillResolutionDTO[],
  ) {
    return await invoke<WorkflowBundleImportResultDTO>("import_workflow_bundle", {
      repoPath,
      repositoryId,
      bundlePath,
      workflowId,
      now,
      resolutions,
    });
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
    const stored =
      (await preferencesStore.get<LayoutPrefsDTO>(LAYOUT_KEY)) ??
      (await store.get<LayoutPrefsDTO>(LAYOUT_KEY));
    return stored ?? null;
  },

  async saveLayout(prefs: LayoutPrefsDTO) {
    await preferencesStore.set(LAYOUT_KEY, prefs);
    await preferencesStore.save();
  },

  async loadCliSettings() {
    const stored =
      (await preferencesStore.get<CliSettingsDTO>(CLI_SETTINGS_KEY)) ??
      (await store.get<CliSettingsDTO>(CLI_SETTINGS_KEY));
    return stored ?? null;
  },

  async saveCliSettings(settings: CliSettingsDTO) {
    await preferencesStore.set(CLI_SETTINGS_KEY, settings);
    await preferencesStore.save();
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

  async setAppIconRunBadgeCount(count: number) {
    await getCurrentWindow().setBadgeCount(count > 0 ? count : undefined);
  },

  async notifyRunFinished(notification) {
    let permissionGranted = await isPermissionGranted();
    if (!permissionGranted) {
      const permission = await requestPermission();
      permissionGranted = permission === "granted";
    }
    if (!permissionGranted) return;

    sendNotification(notification);
  },

  async onRunCompletionNotificationClicked(handler) {
    const listener = await onAction((notification) => {
      const repositoryId = (notification as { repositoryId?: unknown }).repositoryId;
      if (typeof repositoryId === "string" && repositoryId) handler(repositoryId);
    });
    return () => {
      void listener.unregister();
    };
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
