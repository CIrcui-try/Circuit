import type { WorkflowSkillNode } from "../../workflow/schema";
import type {
  SkillExecutionContext,
  SkillExecutionResult,
} from "../contracts/SkillExecution";
import { assertInsideRepoRoot } from "../safety/pathPolicy";
import { parseSkillMeta } from "../../skills/parseSkillMeta";

export const DEFAULT_TIMEOUT_MS = 300_000;

export type ReadSkillFile = (
  absPath: string,
  repoRoot: string,
) => Promise<string>;

export interface BuildSkillExecutionContextDeps {
  readSkillFile: ReadSkillFile;
  readSystemSkill?: (systemSkillId: string) => Promise<string>;
}

export interface BuildSkillExecutionContextInput {
  runId: string;
  workflowId: string;
  node: WorkflowSkillNode;
  repository: { id: string; name: string; path: string };
  previousOutputs: Record<string, SkillExecutionResult>;
  timeoutMs?: number;
  env?: Record<string, string>;
}

export async function buildSkillExecutionContext(
  input: BuildSkillExecutionContextInput,
  deps: BuildSkillExecutionContextDeps,
): Promise<SkillExecutionContext> {
  const {
    runId,
    workflowId,
    node,
    repository,
    previousOutputs,
    timeoutMs,
    env,
  } = input;

  if (!repository.path.startsWith("/")) {
    throw new Error(
      `repository.path must be an absolute path, got "${repository.path}"`,
    );
  }
  const normalizedRoot = normalize(repository.path);
  if (normalizedRoot === "/") {
    throw new Error("repository.path cannot be filesystem root");
  }
  assertInsideRepoRoot(normalizedRoot, normalizedRoot);

  const source = node.skillRef.source ?? "repository";
  if (source === "system") {
    return await buildSystemSkillContext(input, deps, normalizedRoot);
  }

  const skillFile = node.skillRef.skillFile;
  if (!skillFile) {
    throw new Error(`node ${node.id} is missing skillRef.skillFile`);
  }
  const skillFileAbsPath = resolveSkillFilePath(skillFile, repository.path);
  assertInsideRepoRoot(skillFileAbsPath, repository.path);

  const rootDir = dirname(skillFileAbsPath);
  const content = await deps.readSkillFile(skillFileAbsPath, repository.path);
  const meta = parseSkillMeta(content, basename(rootDir));

  return {
    runId,
    workflowId,
    nodeId: node.id,
    repository: {
      id: repository.id,
      name: repository.name,
      path: repository.path,
    },
    skill: {
      source,
      provider: node.skillRef.provider,
      name: meta.name,
      rootDir,
      skillFile,
      skillFileAbsPath,
      content,
    },
    input: node.input ?? {},
    previousOutputs,
    execution: {
      timeoutMs: resolveTimeoutMs(timeoutMs),
      cwd: repository.path,
      ...(env ? { env } : {}),
    },
  };
}

async function buildSystemSkillContext(
  input: BuildSkillExecutionContextInput,
  deps: BuildSkillExecutionContextDeps,
  normalizedRoot: string,
): Promise<SkillExecutionContext> {
  const {
    runId,
    workflowId,
    node,
    repository,
    previousOutputs,
    timeoutMs,
    env,
  } = input;
  const systemSkillId = node.skillRef.systemSkillId;
  if (!systemSkillId) {
    throw new Error(`node ${node.id} is missing skillRef.systemSkillId`);
  }
  if (!deps.readSystemSkill) {
    throw new Error("system skill reader is not available");
  }

  const content = await deps.readSystemSkill(systemSkillId);
  const meta = parseSkillMeta(content, systemSkillBasename(systemSkillId));
  const virtualRoot = `system://${systemSkillId}`;

  return {
    runId,
    workflowId,
    nodeId: node.id,
    repository: {
      id: repository.id,
      name: repository.name,
      path: repository.path,
    },
    skill: {
      source: "system",
      provider: node.skillRef.provider,
      name: meta.name,
      rootDir: virtualRoot,
      skillFile: systemSkillId,
      skillFileAbsPath: `${virtualRoot}/SKILL.md`,
      systemSkillId,
      content,
    },
    input: node.input ?? {},
    previousOutputs,
    execution: {
      timeoutMs: resolveTimeoutMs(timeoutMs),
      cwd: normalizedRoot,
      ...(env ? { env } : {}),
    },
  };
}

export const MIN_TIMEOUT_MS = 1_000;
export const MAX_TIMEOUT_MS = 60 * 60 * 1000;

function resolveTimeoutMs(timeoutMs: number | undefined): number {
  if (timeoutMs == null) return DEFAULT_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs)) return DEFAULT_TIMEOUT_MS;
  if (timeoutMs < MIN_TIMEOUT_MS) return MIN_TIMEOUT_MS;
  if (timeoutMs > MAX_TIMEOUT_MS) return MAX_TIMEOUT_MS;
  return Math.floor(timeoutMs);
}

function resolveSkillFilePath(skillFile: string, repoRoot: string): string {
  if (skillFile.startsWith("/")) return normalize(skillFile);
  const joined = repoRoot.endsWith("/")
    ? repoRoot + skillFile
    : `${repoRoot}/${skillFile}`;
  return normalize(joined);
}

function normalize(input: string): string {
  if (input.length === 0) return ".";
  const isAbsolute = input.startsWith("/");
  const segments = input.split("/").filter((s) => s.length > 0 && s !== ".");
  const stack: string[] = [];
  for (const seg of segments) {
    if (seg === "..") {
      if (stack.length > 0 && stack[stack.length - 1] !== "..") {
        stack.pop();
      } else if (!isAbsolute) {
        stack.push("..");
      }
    } else {
      stack.push(seg);
    }
  }
  const joined = stack.join("/");
  if (isAbsolute) return "/" + joined;
  return joined.length === 0 ? "." : joined;
}

function dirname(absPath: string): string {
  const idx = absPath.lastIndexOf("/");
  if (idx <= 0) return "/";
  return absPath.slice(0, idx);
}

function basename(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? path : path.slice(idx + 1);
}

function systemSkillBasename(systemSkillId: string): string {
  const parts = systemSkillId.split(/[/:]/).filter(Boolean);
  return parts[parts.length - 1] ?? systemSkillId;
}
