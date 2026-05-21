import type { WorkflowSkillNode } from "../../workflow/schema";
import type {
  SkillExecutionContext,
  SkillExecutionResult,
  SkillRerunContext,
} from "../contracts/SkillExecution";
import { assertInsideRepoRoot } from "../safety/pathPolicy";
import { parseSkillMeta } from "../../skills/parseSkillMeta";

export const DEFAULT_TIMEOUT_MS = 300_000;
const RERUN_LOG_TAIL_CHARS = 4 * 1024;

export type ReadSkillFile = (
  absPath: string,
  repoRoot: string,
) => Promise<string>;

export interface BuildSkillExecutionContextDeps {
  readSkillFile: ReadSkillFile;
  readSystemSkill?: (systemSkillId: string) => Promise<string>;
  readDefaultSkill?: (skillFile: string) => Promise<string>;
}

export interface BuildSkillExecutionContextInput {
  runId: string;
  workflowId: string;
  node: WorkflowSkillNode;
  repository: { id: string; name: string; path: string };
  previousOutputs: Record<string, SkillExecutionResult>;
  rerunPreviousAttempt?: SkillExecutionResult;
  timeoutMs?: number;
  model?: string;
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
    model,
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
  if (source === "default") {
    return await buildDefaultSkillContext(input, deps, normalizedRoot);
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
    ...formatRerun(input.rerunPreviousAttempt),
    execution: {
      timeoutMs: resolveTimeoutMs(timeoutMs),
      cwd: repository.path,
      ...(model ? { model } : {}),
      ...(env ? { env } : {}),
    },
  };
}

async function buildDefaultSkillContext(
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
    model,
    env,
  } = input;
  const skillFile = node.skillRef.skillFile;
  if (!skillFile) {
    throw new Error(`node ${node.id} is missing skillRef.skillFile`);
  }
  if (!deps.readDefaultSkill) {
    throw new Error("default skill reader is not available");
  }

  const content = await deps.readDefaultSkill(skillFile);
  const rootDir = `default://${dirname(skillFile)}`;
  const meta = parseSkillMeta(content, basename(dirname(skillFile)));

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
      source: "default",
      provider: node.skillRef.provider,
      name: meta.name,
      rootDir,
      skillFile,
      skillFileAbsPath: `${rootDir}/SKILL.md`,
      content,
    },
    input: node.input ?? {},
    previousOutputs,
    ...formatRerun(input.rerunPreviousAttempt),
    execution: {
      timeoutMs: resolveTimeoutMs(timeoutMs),
      cwd: normalizedRoot,
      ...(model ? { model } : {}),
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
    model,
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
    ...formatRerun(input.rerunPreviousAttempt),
    execution: {
      timeoutMs: resolveTimeoutMs(timeoutMs),
      cwd: normalizedRoot,
      ...(model ? { model } : {}),
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

function formatRerun(
  previousAttempt: SkillExecutionResult | undefined,
): { rerun?: SkillRerunContext } {
  if (!previousAttempt) return {};
  return { rerun: buildRerunContext(previousAttempt) };
}

function buildRerunContext(
  previousAttempt: SkillExecutionResult,
): SkillRerunContext {
  const stdout = collectLogText(previousAttempt, "stdout");
  const stderr = collectLogText(previousAttempt, "stderr");
  const stdoutTail = takeTail(stdout, RERUN_LOG_TAIL_CHARS);
  const stderrTail = takeTail(stderr, RERUN_LOG_TAIL_CHARS);

  return {
    previousAttempt,
    ...formatLastError(previousAttempt),
    stdoutTail: stdoutTail.text,
    stderrTail: stderrTail.text,
    stdoutTruncated: stdoutTail.truncated,
    stderrTruncated: stderrTail.truncated,
  };
}

function collectLogText(
  result: SkillExecutionResult,
  type: "stdout" | "stderr",
): string {
  const chunks: string[] = [];
  for (const ev of result.logs) {
    if (ev.type === type) chunks.push(ev.text);
  }
  return chunks.join("");
}

function formatLastError(
  result: SkillExecutionResult,
): { lastError?: string } {
  for (let i = result.logs.length - 1; i >= 0; i -= 1) {
    const ev = result.logs[i];
    if (ev.type === "error" && ev.message.trim().length > 0) {
      return { lastError: ev.message.trim() };
    }
  }
  for (let i = result.logs.length - 1; i >= 0; i -= 1) {
    const ev = result.logs[i];
    if (ev.type === "stderr" && ev.text.trim().length > 0) {
      return { lastError: ev.text.trim() };
    }
  }
  return {};
}

function takeTail(text: string, maxChars: number): {
  text: string;
  truncated: boolean;
} {
  if (text.length <= maxChars) return { text, truncated: false };
  return { text: text.slice(text.length - maxChars), truncated: true };
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
