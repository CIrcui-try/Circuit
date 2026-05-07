import type {
  SkillExecutionContext,
  SkillExecutionResult,
} from "../contracts/SkillExecution";

const MAX_STDOUT_LINES = 200;
const MAX_STDOUT_BYTES = 8 * 1024;

export function buildSkillPrompt(ctx: SkillExecutionContext): string {
  const inputJson = JSON.stringify(ctx.input ?? {}, null, 2);
  const sections: string[] = [
    `# Skill: ${ctx.skill.name}`,
    "",
    ctx.skill.content,
    "",
    "# Input",
    "",
    inputJson,
  ];

  const upstream = formatUpstreamOutputs(ctx.previousOutputs);
  if (upstream != null) {
    sections.push("", upstream);
  }

  return sections.join("\n");
}

function formatUpstreamOutputs(
  previousOutputs: Record<string, SkillExecutionResult>,
): string | null {
  const ids = Object.keys(previousOutputs).sort();
  if (ids.length === 0) return null;

  const lines: string[] = ["# Upstream Outputs", ""];
  for (const id of ids) {
    const result = previousOutputs[id];
    const exit =
      result.exitCode != null ? `exit: ${result.exitCode}` : "exit: -";
    lines.push(`## ${id}  (status: ${result.status}, ${exit})`);
    lines.push("");
    lines.push(extractStdout(result));
    lines.push("");
  }
  while (lines[lines.length - 1] === "") lines.pop();
  return lines.join("\n");
}

function extractStdout(result: SkillExecutionResult): string {
  const chunks: string[] = [];
  for (const ev of result.logs) {
    if (ev.type === "stdout") chunks.push(ev.text);
  }
  const joined = chunks.join("");
  if (joined.length === 0) return "(no stdout)";

  let truncated = false;
  let kept = joined.split("\n");
  if (kept.length > MAX_STDOUT_LINES) {
    kept = kept.slice(kept.length - MAX_STDOUT_LINES);
    truncated = true;
  }
  let body = kept.join("\n");
  if (body.length > MAX_STDOUT_BYTES) {
    body = body.slice(body.length - MAX_STDOUT_BYTES);
    truncated = true;
  }
  return truncated ? `… (truncated)\n${body}` : body;
}
