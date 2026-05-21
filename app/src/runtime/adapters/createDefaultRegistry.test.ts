import { describe, expect, it } from "vitest";
import { createMockRuntimeBridge } from "../bridge/RuntimeBridge.mock";
import {
  DEFAULT_PROVIDER_ALLOWLIST,
  createDefaultRegistry,
} from "./createDefaultRegistry";

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

  it("D3: applies the default [claude, codex] allowlist", () => {
    const bridge = createMockRuntimeBridge();
    const reg = createDefaultRegistry({ bridge });
    expect(reg.getAllowlist()).toEqual(DEFAULT_PROVIDER_ALLOWLIST);
  });

  it("D4: allowlist=null disables the restriction", () => {
    const bridge = createMockRuntimeBridge();
    const reg = createDefaultRegistry({ bridge, allowlist: null });
    expect(reg.getAllowlist()).toBeNull();
  });

  it("D5: caller-supplied allowlist replaces the default", () => {
    const bridge = createMockRuntimeBridge();
    const reg = createDefaultRegistry({ bridge, allowlist: ["claude"] });
    expect(reg.getAllowlist()).toEqual(["claude"]);
  });
});
