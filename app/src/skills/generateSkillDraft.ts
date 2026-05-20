import { getRuntimeBridge, type RuntimeBridge } from "../runtime/bridge/RuntimeBridge";
import {
  cliResolveError,
  resolveCliCommand,
} from "../runtime/bridge/resolveCliCommand";
import type { SkillProvider } from "../stores/skillStore";

export type GeneratedSkillDraft = {
  provider: SkillProvider;
  name: string;
  description: string;
  slug: string;
  argumentHint: string;
  defaultPrompt: string;
  defaultModel: string;
};

export type GenerateSkillDraftOptions = {
  goal: string;
  preferredProvider: SkillProvider;
  repoPath: string;
  bridge?: RuntimeBridge;
  runId?: string;
  timeoutMs?: number;
  onRunStart?: (runId: string, bridge: RuntimeBridge) => void;
  isRunCancelled?: (runId: string) => boolean;
};

export async function generateSkillDraft(
  opts: GenerateSkillDraftOptions,
): Promise<GeneratedSkillDraft> {
  const goal = opts.goal.trim();
  if (!goal) {
    throw new Error("Describe what you want this skill to do first.");
  }

  const bridge = opts.bridge ?? getRuntimeBridge();
  const runId = opts.runId ?? `skill-draft-${Date.now()}`;
  opts.onRunStart?.(runId, bridge);
  const prompt = buildDraftPrompt(goal, opts.preferredProvider);
  const resolved = await resolveCliCommand(bridge, "codex");
  if (resolved.resolve && !resolved.resolve.ok) {
    throw new Error(`Codex CLI unavailable: ${cliResolveError(resolved.resolve)}`);
  }
  if (opts.isRunCancelled?.(runId)) {
    throw new Error("Codex draft generation was cancelled.");
  }

  const stdout = await runCodexJsonDraft({
    bridge,
    runId,
    command: resolved.command,
    prompt,
    repoPath: opts.repoPath,
    timeoutMs: opts.timeoutMs ?? 60_000,
    isRunCancelled: opts.isRunCancelled,
  });
  return parseGeneratedSkillDraft(stdout);
}

function buildDraftPrompt(goal: string, preferredProvider: SkillProvider): string {
  return [
    "You generate metadata for a local agent skill.",
    "Return strict JSON only. Do not include markdown fences or commentary.",
    "The JSON object must have exactly these string keys:",
    "provider, name, description, slug, argumentHint, defaultPrompt, defaultModel.",
    `Prefer provider "${preferredProvider}" unless the request clearly needs the other provider.`,
    "provider must be either \"codex\" or \"claude\".",
    "name must be one short single-line display name.",
    "description must be one concise single-line sentence.",
    "slug must use only ASCII letters, numbers, hyphens, or underscores.",
    "argumentHint describes the slash-command style arguments this skill accepts, such as \"<ISSUE_ID> [--force]\"; use an empty string when not needed.",
    "defaultPrompt is the default free-form prompt for the skill; use an empty string when not needed.",
    "defaultModel is optional; use an empty string unless the user clearly requested a model.",
    "",
    "User request:",
    goal,
  ].join("\n");
}

function runCodexJsonDraft(args: {
  bridge: RuntimeBridge;
  runId: string;
  command: string;
  prompt: string;
  repoPath: string;
  timeoutMs: number;
  isRunCancelled?: (runId: string) => boolean;
}): Promise<string> {
  const { bridge, runId, command, prompt, repoPath, timeoutMs, isRunCancelled } =
    args;
  let stdout = "";
  let stderr = "";

  return new Promise<string>((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      unsubscribe();
      fn();
    };

    const unsubscribe = bridge.subscribe(runId, (ev) => {
      switch (ev.type) {
        case "stdout":
          stdout += ev.text;
          return;
        case "stderr":
          stderr += ev.text;
          return;
        case "exited":
          finish(() => {
            if (ev.exitCode === 0) {
              resolve(stdout.trim());
            } else {
              reject(
                new Error(
                  `Codex draft generation failed with exit code ${ev.exitCode}: ${formatProcessText(stderr || stdout)}`,
                ),
              );
            }
          });
          return;
        case "error":
          finish(() => reject(new Error(ev.message)));
          return;
        case "timeout":
          finish(() => reject(new Error("Codex draft generation timed out.")));
          return;
        case "cancelled":
          finish(() => reject(new Error("Codex draft generation was cancelled.")));
          return;
        default:
          return;
      }
    });

    unsubscribe.ready
      .then(() => {
        if (isRunCancelled?.(runId)) {
          throw new Error("Codex draft generation was cancelled.");
        }
        return bridge.spawn({
          runId,
          command,
          args: [
            "-a",
            "on-request",
            "-s",
            "workspace-write",
            "--add-dir",
            `${repoPath}/.git`,
            "--add-dir",
            `${repoPath}/.codex`,
            "exec",
            prompt,
          ],
          cwd: repoPath,
          timeoutMs,
          stdinMode: "null",
        });
      })
      .catch((err: unknown) => {
        finish(() => reject(err instanceof Error ? err : new Error(String(err))));
      });
  });
}

export function parseGeneratedSkillDraft(raw: string): GeneratedSkillDraft {
  const json = extractJson(raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("Codex returned a draft that was not valid JSON.");
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Codex returned an invalid skill draft.");
  }

  const record = parsed as Record<string, unknown>;
  const provider = readString(record, "provider");
  if (provider !== "codex" && provider !== "claude") {
    throw new Error("Codex returned an invalid provider.");
  }

  const draft: GeneratedSkillDraft = {
    provider,
    name: readString(record, "name").trim(),
    description: oneLine(readString(record, "description")),
    slug: readString(record, "slug").trim(),
    argumentHint: oneLine(readString(record, "argumentHint")),
    defaultPrompt: oneLine(readString(record, "defaultPrompt")),
    defaultModel: oneLine(readString(record, "defaultModel")),
  };

  if (!draft.name || draft.name.includes("\n")) {
    throw new Error("Codex returned an invalid skill name.");
  }
  if (!draft.slug || !/^[A-Za-z0-9_-]+$/.test(draft.slug)) {
    throw new Error("Codex returned an invalid skill slug.");
  }
  return draft;
}

function extractJson(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) return trimmed;
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end <= start) {
    throw new Error("Codex returned a draft without a JSON object.");
  }
  return trimmed.slice(start, end + 1);
}

function readString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string") {
    throw new Error(`Codex returned an invalid ${key}.`);
  }
  return value;
}

function oneLine(value: string): string {
  return value
    .trim()
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ");
}

function formatProcessText(text: string): string {
  const trimmed = text.trim();
  return trimmed.length > 0 ? trimmed : "no output";
}
