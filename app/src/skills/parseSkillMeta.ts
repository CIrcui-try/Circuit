export type SkillMeta = {
  name: string;
  description: string;
  inputHints: SkillInputHint[];
};

export type SkillInputHint = {
  kind: "command";
  key: "arguments";
  placeholder: string;
};

export function parseSkillMeta(content: string, dirName: string): SkillMeta {
  const fm = extractFrontmatter(content);
  const name =
    fm.name ?? extractFirstHeading(stripFrontmatter(content, fm.matched)) ?? dirName;
  const description = fm.description ?? "";
  const inputHints = extractInputHints(content);
  return { name, description, inputHints };
}

type Frontmatter = {
  name?: string;
  description?: string;
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
  }
  return result;
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
  if (!/\$ARGUMENTS|Command Template/i.test(content)) return [];

  const placeholder = extractArgumentsFormat(content) ?? "$ARGUMENTS";
  return [
    {
      kind: "command",
      key: "arguments",
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
