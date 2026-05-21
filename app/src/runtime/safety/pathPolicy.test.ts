import { describe, it, expect } from "vitest";
import {
  assertInsideRepoRoot,
  isInsideRepoRoot,
  PathOutsideRepoRootError,
} from "./pathPolicy";

describe("pathPolicy", () => {
  it("accepts a file directly under repo root", () => {
    expect(isInsideRepoRoot("/repo/file.txt", "/repo")).toBe(true);
  });

  it("accepts a nested file under repo root", () => {
    expect(isInsideRepoRoot("/repo/sub/dir/file.txt", "/repo")).toBe(true);
  });

  it("accepts the repo root itself", () => {
    expect(isInsideRepoRoot("/repo", "/repo")).toBe(true);
  });

  it("rejects a sibling whose name shares a prefix", () => {
    expect(isInsideRepoRoot("/repo-other/file.txt", "/repo")).toBe(false);
  });

  it("rejects a path outside repo root", () => {
    expect(isInsideRepoRoot("/etc/passwd", "/repo")).toBe(false);
  });

  it("rejects path traversal escape via ..", () => {
    expect(isInsideRepoRoot("/repo/../etc/passwd", "/repo")).toBe(false);
  });

  it("normalizes redundant segments", () => {
    expect(isInsideRepoRoot("/repo/./sub/./file.txt", "/repo")).toBe(true);
  });

  it("assertInsideRepoRoot throws PathOutsideRepoRootError on escape", () => {
    expect(() => assertInsideRepoRoot("/etc/passwd", "/repo")).toThrow(
      PathOutsideRepoRootError,
    );
  });
});
