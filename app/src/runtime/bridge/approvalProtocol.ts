import type { RuntimeApprovalKind } from "./RuntimeBridge";

export interface DetectedApproval {
  requestId: string;
  prompt: string;
  kind: RuntimeApprovalKind;
}

export interface DetectApprovalOptions {
  /**
   * Override `crypto.randomUUID()` so tests can produce deterministic IDs.
   */
  newRequestId?: () => string;
}

// 1차 휴리스틱. codex 의 trust prompt / approve-command prompt 두 패턴만 확실히
// 잡고 그 외에는 null. 패턴이 늘어나면 여기에 한 줄씩 추가하고 테스트에 회귀
// 케이스를 기록한다. JSONL 모드 (`codex exec --json`) 가 1차 통합되면 이
// 휴리스틱 자체가 사라질 예정이라 정밀도보다 명확함을 우선.
const TRUST_PATTERNS: RegExp[] = [
  /do you trust this (?:directory|workspace|folder)\??/i,
  /trust this (?:directory|workspace|folder) and proceed\??/i,
  /allow access to this (?:directory|workspace)\??/i,
];

const COMMAND_PATTERNS: RegExp[] = [
  /allow this command\??/i,
  /approve (?:running )?this command\??/i,
  /approve to (?:run|execute)\b.*\?/i,
];

function defaultNewId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Fallback for environments without crypto (e.g. older Node test runners).
  return `req-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
}

/**
 * Inspect a single stdout/stderr line and decide whether it is the CLI asking
 * for an interactive approval. Returns `null` if the line is unrelated.
 */
export function detectApprovalPrompt(
  line: string,
  options: DetectApprovalOptions = {},
): DetectedApproval | null {
  const newId = options.newRequestId ?? defaultNewId;
  for (const pattern of TRUST_PATTERNS) {
    if (pattern.test(line)) {
      return {
        requestId: newId(),
        prompt: line.trim(),
        kind: "trust",
      };
    }
  }
  for (const pattern of COMMAND_PATTERNS) {
    if (pattern.test(line)) {
      return {
        requestId: newId(),
        prompt: line.trim(),
        kind: "command",
      };
    }
  }
  return null;
}

/**
 * Detect approvals across a multi-line chunk. Splits on `\n` so callers can
 * pass raw stderr buffers without pre-tokenising.
 */
export function detectApprovalPromptsInChunk(
  chunk: string,
  options: DetectApprovalOptions = {},
): DetectedApproval[] {
  const out: DetectedApproval[] = [];
  for (const rawLine of chunk.split(/\r?\n/)) {
    const detected = detectApprovalPrompt(rawLine, options);
    if (detected) out.push(detected);
  }
  return out;
}
