export const SENSITIVE_KEYWORDS = [
  "push",
  "deploy",
  "delete",
  "rm",
  "release",
] as const;

export type SensitiveKeyword = (typeof SENSITIVE_KEYWORDS)[number];

export interface SensitiveActionInput {
  skillName?: string;
  prompt?: string;
  skillContent?: string;
}

export interface SensitiveActionHits {
  matched: boolean;
  keywords: SensitiveKeyword[];
  sources: {
    skillName: SensitiveKeyword[];
    prompt: SensitiveKeyword[];
    skillContent: SensitiveKeyword[];
  };
}

const PATTERNS: Record<SensitiveKeyword, RegExp> = {
  push: /\bpush\b/i,
  deploy: /\bdeploy\b/i,
  delete: /\bdelete\b/i,
  rm: /\brm\b/i,
  release: /\brelease\b/i,
};

function findKeywords(text: string | undefined): SensitiveKeyword[] {
  if (!text) return [];
  const out: SensitiveKeyword[] = [];
  for (const k of SENSITIVE_KEYWORDS) {
    if (PATTERNS[k].test(text)) out.push(k);
  }
  return out;
}

export function detectSensitiveAction(
  input: SensitiveActionInput,
): SensitiveActionHits {
  const sources = {
    skillName: findKeywords(input.skillName),
    prompt: findKeywords(input.prompt),
    skillContent: findKeywords(input.skillContent),
  };
  const merged = new Set<SensitiveKeyword>([
    ...sources.skillName,
    ...sources.prompt,
    ...sources.skillContent,
  ]);
  const keywords = SENSITIVE_KEYWORDS.filter((k) => merged.has(k));
  return {
    matched: keywords.length > 0,
    keywords,
    sources,
  };
}
