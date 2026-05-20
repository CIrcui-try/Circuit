import { tauriHostBridge } from "./tauriBridge";
import type { Repository } from "../stores/repositoryStore";

export type RawSkill = {
  provider: "claude" | "codex";
  source?: "repository" | "default";
  dirName: string;
  rootDir: string;
  skillFile: string;
  skillFileAbsPath?: string;
  content: string;
};

export type CreateRepositorySkillInput = {
  provider: "claude" | "codex";
  slug: string;
  name: string;
  description: string;
  argumentHint?: string;
  defaultArguments?: string;
  defaultPrompt?: string;
  defaultModel?: string;
};

export type DeleteRepositorySkillInput = {
  provider: "claude" | "codex";
  slug: string;
};

export type RawSystemSkill = {
  id: string;
  provider: "claude" | "codex";
  name: string;
  description: string;
  source: "system";
};

export type SkillInputHint = {
  kind: "command";
  key: "arguments";
  label: string;
  placeholder: string;
};

export type WorkflowSummaryDTO = {
  id: string;
  name: string;
  updatedAt: string;
};

export type RunLogEntryDTO = {
  runId: string;
  savedAt: string;
};

export type LayoutPrefsDTO = {
  sidebarWidth: number;
  propsWidth: number;
  logHeight: number;
  sidebarCollapsed?: boolean;
  commonSkillsCollapsed?: boolean;
  propsCollapsed?: boolean;
  logCollapsed?: boolean;
};

export type CliSettingsDTO = {
  claudePath?: string;
  codexPath?: string;
};

export type RunCompletionNotification = {
  title: string;
  body?: string;
  repositoryId?: string;
};

export type RepositoryEnvironmentCheckItem = {
  ok: boolean;
  message?: string | null;
};

export type RepositoryEnvironmentCheck = {
  repoRoot: RepositoryEnvironmentCheckItem;
  gitCommonDir: RepositoryEnvironmentCheckItem;
  codexStateDir: RepositoryEnvironmentCheckItem;
};

export type McpConfigFileStatus = {
  path: string;
  ok: boolean;
  missing: boolean;
  message?: string | null;
};

export type McpServerSummary = {
  provider: "claude" | "codex";
  scope: "global" | "project" | "user";
  projectPath?: string | null;
  name: string;
  transport?: string | null;
  command?: string | null;
  args: string[];
  url?: string | null;
  hasEnv: boolean;
  authRequired?: boolean | null;
};

export type McpConfigStatus = {
  claude: {
    config: McpConfigFileStatus;
    authCache: McpConfigFileStatus;
    servers: McpServerSummary[];
  };
  codex: {
    config: McpConfigFileStatus;
    servers: McpServerSummary[];
  };
};

export type WorkspaceDTO = {
  id: string;
  path: string;
  branch: string | null;
  headCommit: string;
  userId: string;
  repoUrl: string;
};

/// Phase 7 (CIR-35): typed wrapper around the Tauri workspace commands. Methods
/// are optional on `HostBridge` so test fakes / non-Tauri preview environments
/// can omit them and the runner falls back to the legacy "spawn straight in the
/// repo path" flow.
export interface WorkspaceBridge {
  acquireWorkspace(userId: string, repoUrl: string): Promise<WorkspaceDTO>;
  releaseToPool(workspaceId: string): Promise<void>;
  cleanupWorkspace(workspaceId: string): Promise<void>;
  beginTurn(workspaceId: string, turnIndex: number): Promise<void>;
  commitTurn(workspaceId: string): Promise<void>;
  prewarm(userId: string, repoUrl: string, count: number): Promise<void>;
}

export interface HostBridge extends Partial<WorkspaceBridge> {
  openRepositoryDialog(): Promise<string | null>;
  createTutorialRepository?(): Promise<string>;
  pathExists?(path: string): Promise<boolean>;
  checkRepositoryEnvironment?(
    repoPath: string,
  ): Promise<RepositoryEnvironmentCheck>;
  readMcpConfigStatus?(): Promise<McpConfigStatus>;
  scanSkills(repoPath: string): Promise<RawSkill[]>;
  createRepositorySkill?(
    repoPath: string,
    input: CreateRepositorySkillInput,
  ): Promise<RawSkill>;
  deleteRepositorySkill?(
    repoPath: string,
    input: DeleteRepositorySkillInput,
  ): Promise<void>;
  scanDefaultSkills?(): Promise<RawSkill[]>;
  scanSystemSkills?(): Promise<RawSystemSkill[]>;
  loadRepositories(): Promise<Repository[] | null>;
  saveRepositories(repos: Repository[]): Promise<void>;
  listWorkflows(repoPath: string): Promise<WorkflowSummaryDTO[]>;
  loadWorkflow(repoPath: string, workflowId: string): Promise<string>;
  saveWorkflow(repoPath: string, workflowId: string, json: string): Promise<void>;
  saveRunLog?(
    repoPath: string,
    workflowId: string,
    runId: string,
    jsonl: string,
  ): Promise<void>;
  listRunLogs?(
    repoPath: string,
    workflowId: string,
  ): Promise<RunLogEntryDTO[]>;
  loadRunLog?(
    repoPath: string,
    workflowId: string,
    runId: string,
  ): Promise<string>;
  loadLayout?(): Promise<LayoutPrefsDTO | null>;
  saveLayout?(prefs: LayoutPrefsDTO): Promise<void>;
  loadCliSettings?(): Promise<CliSettingsDTO | null>;
  saveCliSettings?(settings: CliSettingsDTO): Promise<void>;
  setAppIconRunBadgeCount?(count: number): Promise<void>;
  notifyRunFinished?(notification: RunCompletionNotification): Promise<void>;
  onRunCompletionNotificationClicked?(
    handler: (repositoryId: string) => void,
  ): Promise<() => void>;
  isAppWindowFocused?(): Promise<boolean>;
  onAppWindowFocusChanged?(
    handler: (focused: boolean) => void,
  ): Promise<() => void>;
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
