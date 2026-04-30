import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { LazyStore } from "@tauri-apps/plugin-store";
import type { HostBridge, RawSkill, WorkflowSummaryDTO } from "./bridge";
import type { Repository } from "../stores/repositoryStore";

const STORE_FILE = "repositories.json";
const STORE_KEY = "repositories";

const store = new LazyStore(STORE_FILE);

export const tauriHostBridge: HostBridge = {
  async openRepositoryDialog() {
    const selected = await open({ directory: true, multiple: false });
    return typeof selected === "string" ? selected : null;
  },

  async scanSkills(repoPath: string) {
    return await invoke<RawSkill[]>("scan_skills", { repoPath });
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
};
