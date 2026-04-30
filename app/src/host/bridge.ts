import { tauriHostBridge } from "./tauriBridge";
import type { Repository } from "../stores/repositoryStore";

export type RawSkill = {
  provider: "claude" | "codex";
  dirName: string;
  rootDir: string;
  skillFile: string;
  content: string;
};

export type WorkflowSummaryDTO = {
  id: string;
  name: string;
  updatedAt: string;
};

export interface HostBridge {
  openRepositoryDialog(): Promise<string | null>;
  scanSkills(repoPath: string): Promise<RawSkill[]>;
  loadRepositories(): Promise<Repository[] | null>;
  saveRepositories(repos: Repository[]): Promise<void>;
  listWorkflows(repoPath: string): Promise<WorkflowSummaryDTO[]>;
  loadWorkflow(repoPath: string, workflowId: string): Promise<string>;
  saveWorkflow(repoPath: string, workflowId: string, json: string): Promise<void>;
}

declare global {
  interface Window {
    __CIRCUIT_BRIDGE__?: HostBridge;
  }
}

export function getHostBridge(): HostBridge {
  if (typeof window !== "undefined" && window.__CIRCUIT_BRIDGE__) {
    return window.__CIRCUIT_BRIDGE__;
  }
  return tauriHostBridge;
}
