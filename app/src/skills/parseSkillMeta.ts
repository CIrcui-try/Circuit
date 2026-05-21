export type SkillMeta = {
  name: string;
  description: string;
  inputHints: SkillInputHint[];
  defaultInput?: Record<string, string>;
  defaultModel?: string;
};

export type SkillInputHint = {
  kind: "command";
  key: "arguments";
  label: string;
  placeholder: string;
};

export function parseSkillMeta(content: string, dirName: string): SkillMeta {
  const fm = extractFrontmatter(content);
  const name =
    fm.name ?? extractFirstHeading(stripFrontmatter(content, fm.matched)) ?? dirName;
  const description = fm.description ?? "";
  const inputHints = extractInputHints(content);
  const defaultInput = buildDefaultInput(fm);
  return {
    name,
    description,
    inputHints,
    ...(defaultInput ? { defaultInput } : {}),
    ...(fm.defaultModel ? { defaultModel: fm.defaultModel } : {}),
  };
}

type Frontmatter = {
  name?: string;
  description?: string;
  argumentHint?: string;
  defaultArguments?: string;
  defaultPrompt?: string;
  defaultModel?: string;
  matched: boolean;
};

function extractFrontmatter(content: string): Frontmatter {
  if (!content.startsWith("---")) return { matched: false };

  const afterOpen = content.slice(3);
  const newlineIdx = afterOpen.indexOf("\n");
  if (newlineIdx === -1) return { matched: false };

  const body = afterOpen.slice(newlineIdx + 1);
  const closeMatch = body.match(/(^|\n)---\s*(?:\n|$)/);
  if (!closeMatch) return { matched: false };

  const fmBlock = body.slice(0, closeMatch.index ?? 0);
  const result: Frontmatter = { matched: true };
  for (const line of fmBlock.split("\n")) {
    const m = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*?)\s*$/);
    if (!m) continue;
    const key = m[1];
    const value = unquote(m[2]);
    if (key === "name") result.name = value;
    else if (key === "description") result.description = value;
    else if (key === "argument-hint") result.argumentHint = value;
    else if (key === "default-arguments") result.defaultArguments = value;
    else if (key === "default-prompt") result.defaultPrompt = value;
    else if (key === "default-model") result.defaultModel = value;
  }
  return result;
}

function buildDefaultInput(fm: Frontmatter): Record<string, string> | undefined {
  const input: Record<string, string> = {};
  if (fm.defaultArguments) input.arguments = fm.defaultArguments;
  if (fm.defaultPrompt) input.prompt = fm.defaultPrompt;
  return Object.keys(input).length > 0 ? input : undefined;
}

function stripFrontmatter(content: string, matched: boolean): string {
  if (!matched) return content;
  const afterOpen = content.slice(3);
  const newlineIdx = afterOpen.indexOf("\n");
  if (newlineIdx === -1) return content;
  const body = afterOpen.slice(newlineIdx + 1);
  const closeMatch = body.match(/(^|\n)---\s*(?:\n|$)/);
  if (!closeMatch || closeMatch.index === undefined) return content;
  const tailStart = closeMatch.index + closeMatch[0].length;
  return body.slice(tailStart);
}

function extractFirstHeading(content: string): string | null {
  for (const line of content.split("\n")) {
    const m = line.match(/^#\s+(.+?)\s*$/);
    if (m) return m[1];
  }
  return null;
}

function unquote(value: string): string {
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return value.slice(1, -1);
    }
  }
  return value;
}

function extractInputHints(content: string): SkillInputHint[] {
  const fm = extractFrontmatter(content);
  const placeholder = fm.argumentHint ?? extractArgumentsFormat(content);
  if (!placeholder) return [];

  return [
    {
      kind: "command",
      key: "arguments",
      label: labelFromPlaceholder(placeholder),
      placeholder,
    },
  ];
}

function extractArgumentsFormat(content: string): string | null {
  const lines = content.split("\n");
  for (const line of lines) {
    if (!line.includes("$ARGUMENTS")) continue;

    const inlineCode = line.match(/`([^`]*<[^`]+>[^`]*)`/);
    if (inlineCode) return inlineCode[1].trim();

    const afterColon = line.match(/[:：]\s*(.+?)\s*(?:[.。]|$)/);
    if (afterColon) {
      const cleaned = afterColon[1].replace(/`/g, "").trim();
      if (cleaned.length > 0) return cleaned;
    }
  }
  return null;
}

function labelFromPlaceholder(placeholder: string): string {
  const angle = placeholder.match(/<([^>]+)>/);
  if (angle) return angle[1].trim();
  const cleaned = placeholder.replace(/\[[^\]]+\]/g, "").trim();
  return cleaned || "Arguments";
}
