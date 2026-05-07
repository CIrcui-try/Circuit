import { describe, expect, it } from "vitest";
import {
  detectApprovalPrompt,
  detectApprovalPromptsInChunk,
} from "./approvalProtocol";

const idFactory = (() => {
  let n = 0;
  return () => `req-${++n}`;
})();

describe("detectApprovalPrompt", () => {
  it("matches the codex trust-directory prompt", () => {
    const got = detectApprovalPrompt(
      "  Do you trust this directory? [y/N]",
      { newRequestId: idFactory },
    );
    expect(got).toEqual({
      requestId: expect.stringMatching(/^req-\d+$/),
      prompt: "Do you trust this directory? [y/N]",
      kind: "trust",
    });
  });

  it("matches the codex approve-command prompt", () => {
    const got = detectApprovalPrompt("Allow this command?", {
      newRequestId: idFactory,
    });
    expect(got?.kind).toBe("command");
    expect(got?.prompt).toBe("Allow this command?");
  });

  it("returns null for unrelated stderr lines", () => {
    expect(detectApprovalPrompt("warning: something happened")).toBeNull();
    expect(detectApprovalPrompt("error reading config")).toBeNull();
    expect(detectApprovalPrompt("")).toBeNull();
  });

  it("ignores trust-like words inside unrelated sentences", () => {
    expect(detectApprovalPrompt("trust me, this is fine")).toBeNull();
    expect(
      detectApprovalPrompt("the user does not trust the workspace value"),
    ).toBeNull();
  });

  it("returns the first match per line (trust takes precedence over command)", () => {
    const got = detectApprovalPrompt(
      "Do you trust this directory? Allow this command?",
      { newRequestId: idFactory },
    );
    expect(got?.kind).toBe("trust");
  });
});

describe("detectApprovalPromptsInChunk", () => {
  it("returns one detection per matching line and skips non-matching lines", () => {
    const chunk = [
      "starting up",
      "Do you trust this directory?",
      "ok loading",
      "Allow this command?",
      "done",
    ].join("\n");
    const got = detectApprovalPromptsInChunk(chunk, { newRequestId: idFactory });
    expect(got.map((d) => d.kind)).toEqual(["trust", "command"]);
    // Each call must hand out a fresh requestId so multi-prompt sessions don't
    // collapse into one entry in pendingApprovals.
    expect(got[0].requestId).not.toBe(got[1].requestId);
  });

  it("handles CRLF chunks", () => {
    const chunk = "noise\r\nDo you trust this directory?\r\nmore noise";
    const got = detectApprovalPromptsInChunk(chunk);
    expect(got).toHaveLength(1);
    expect(got[0].kind).toBe("trust");
  });

  it("returns an empty array when nothing matches", () => {
    expect(detectApprovalPromptsInChunk("a\nb\nc")).toEqual([]);
  });
});
