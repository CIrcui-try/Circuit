import { describe, expect, it } from "vitest";
import {
  SENSITIVE_KEYWORDS,
  detectSensitiveAction,
} from "./sensitiveAction";

describe("detectSensitiveAction", () => {
  it("S1: returns no matches on empty input", () => {
    const r = detectSensitiveAction({});
    expect(r.matched).toBe(false);
    expect(r.keywords).toEqual([]);
    expect(r.sources.skillName).toEqual([]);
    expect(r.sources.prompt).toEqual([]);
    expect(r.sources.skillContent).toEqual([]);
  });

  it("S2: matches each canonical keyword as a whole word", () => {
    for (const k of SENSITIVE_KEYWORDS) {
      const r = detectSensitiveAction({ prompt: `please ${k} the thing` });
      expect(r.matched).toBe(true);
      expect(r.keywords).toContain(k);
    }
  });

  it("S3: is case-insensitive", () => {
    const r = detectSensitiveAction({
      prompt: "PUSH and DePLoy and DELETE and RM and ReLeAsE",
    });
    expect(r.keywords.sort()).toEqual(
      ["delete", "deploy", "push", "release", "rm"].sort(),
    );
  });

  it("S4: ignores partial-word matches", () => {
    const r = detectSensitiveAction({
      prompt: "pushed deployed deletes terminate released_v1",
      skillName: "harmless",
      skillContent: "// harm",
    });
    // "pushed" matches \bpush\b? no — \bpush\b matches if push is followed by
    // a non-word char or end. "pushed" has 'pushed' as the whole word, so
    // \bpush\b at position 0 with next char 'e' (word char) — no match.
    expect(r.matched).toBe(false);
  });

  it("S5: detects matches separately per source", () => {
    const r = detectSensitiveAction({
      skillName: "deploy-cli",
      prompt: "this will rm files",
      skillContent: "git push origin main",
    });
    expect(r.sources.skillName).toEqual(["deploy"]);
    expect(r.sources.prompt).toEqual(["rm"]);
    expect(r.sources.skillContent).toEqual(["push"]);
    expect(r.keywords.sort()).toEqual(["deploy", "push", "rm"].sort());
  });

  it("S6: dedups when the same keyword appears in multiple sources", () => {
    const r = detectSensitiveAction({
      skillName: "deploy",
      prompt: "deploy now",
      skillContent: "DEPLOY",
    });
    expect(r.keywords).toEqual(["deploy"]);
  });

  it("S7: skips fields when not provided", () => {
    const r = detectSensitiveAction({ prompt: "rm -rf" });
    expect(r.sources.skillName).toEqual([]);
    expect(r.sources.skillContent).toEqual([]);
    expect(r.sources.prompt).toEqual(["rm"]);
  });

  it("S8: returns keywords in canonical order regardless of input order", () => {
    const r = detectSensitiveAction({
      prompt: "release rm push",
    });
    expect(r.keywords).toEqual(["push", "rm", "release"]);
  });
});
