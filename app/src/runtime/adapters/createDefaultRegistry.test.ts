import { describe, expect, it } from "vitest";
import { createMockRuntimeBridge } from "../bridge/RuntimeBridge.mock";
import { createDefaultRegistry } from "./createDefaultRegistry";

describe("createDefaultRegistry", () => {
  it("D1: registers both claude and codex providers", () => {
    const bridge = createMockRuntimeBridge();
    const reg = createDefaultRegistry({ bridge });

    expect(reg.has("claude")).toBe(true);
    expect(reg.has("codex")).toBe(true);
    expect(reg.list().sort()).toEqual(["claude", "codex"]);
  });

  it("D2: get(provider) returns adapter with matching provider field", () => {
    const bridge = createMockRuntimeBridge();
    const reg = createDefaultRegistry({ bridge });

    expect(reg.get("claude").provider).toBe("claude");
    expect(reg.get("codex").provider).toBe("codex");
  });
});
