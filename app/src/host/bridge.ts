import { tauriHostBridge } from "./tauriBridge";
import type { Repository } from "../stores/repositoryStore";

export type RawSkill = {
  provider: "claude" | "codex";
  dirName: string;
  rootDir: string;
  skillFile: string;
  content: string;
};

export interface HostBridge {
  openRepositoryDialog(): Promise<string | null>;
  scanSkills(repoPath: string): Promise<RawSkill[]>;
  loadRepositories(): Promise<Repository[] | null>;
  saveRepositories(repos: Repository[]): Promise<void>;
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
