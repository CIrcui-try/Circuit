import type {
  SkillExecutionContext,
  SkillExecutionResult,
} from "../contracts/SkillExecution";

export function buildDefaultPrompt(ctx: SkillExecutionContext): string {
  const sections: string[] = [];

  sections.push(`# Skill: ${ctx.skill.name}`);

  sections.push(
    [
      "## Repository",
      `- id: ${ctx.repository.id}`,
      `- name: ${ctx.repository.name}`,
      `- path: ${ctx.repository.path}`,
    ].join("\n"),
  );

  sections.push(`## SKILL.md\n\n${ctx.skill.content}`);

  sections.push(`## Input\n\n${formatInput(ctx.input)}`);

  sections.push(
    `## Previous Outputs\n\n${formatPreviousOutputs(ctx.previousOutputs)}`,
  );

  sections.push(
    [
      "## Execution Instructions",
      "",
      "Read the SKILL.md above, follow its instructions using the supplied",
      "Input and Previous Outputs, and respond with the result the skill",
      `defines. Do not modify files outside the repository at ${ctx.repository.path}.`,
    ].join("\n"),
  );

  return sections.join("\n\n");
}

function formatInput(input: Record<string, unknown>): string {
  if (Object.keys(input).length === 0) return "(none)";
  return jsonFence(input);
}

function formatPreviousOutputs(
  previousOutputs: Record<string, SkillExecutionResult>,
): string {
  const entries = Object.entries(previousOutputs);
  if (entries.length === 0) return "(none)";

  return entries
    .map(([nodeId, result]) => {
      const lines: string[] = [];
      lines.push(`### ${nodeId}`);
      lines.push(`- status: ${result.status}`);
      lines.push(`- summary: ${result.summary ?? "(none)"}`);
      lines.push(`- output:`);
      lines.push("");
      lines.push(jsonFence(result.output ?? null));
      return lines.join("\n");
    })
    .join("\n\n");
}

function jsonFence(value: unknown): string {
  return "```json\n" + JSON.stringify(value, null, 2) + "\n```";
}
