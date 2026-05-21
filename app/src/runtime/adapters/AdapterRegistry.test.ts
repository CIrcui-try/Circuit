import { describe, expect, it } from "vitest";

import type { WorkflowSkillProvider } from "../../workflow/schema";
import {
  AdapterRegistry,
  ProviderNotAllowedError,
  UnknownProviderError,
} from "./AdapterRegistry";
import type {
  AdapterAvailability,
  AgentAdapter,
  AgentRunEventSink,
  SkillExecutionContext,
  SkillExecutionResult,
} from "./AgentAdapter";

function stubAdapter(provider: WorkflowSkillProvider): AgentAdapter {
  return {
    provider,
    async canRun(_ctx: SkillExecutionContext): Promise<AdapterAvailability> {
      return { ok: true };
    },
    async run(
      _ctx: SkillExecutionContext,
      _sink: AgentRunEventSink,
    ): Promise<SkillExecutionResult> {
      return {
        status: "success",
        logs: [],
        startedAt: "2026-01-01T00:00:00.000Z",
        finishedAt: "2026-01-01T00:00:00.000Z",
      };
    },
  };
}

describe("AdapterRegistry", () => {
  it("R1 — register + get returns the same adapter reference", () => {
    const registry = new AdapterRegistry();
    const adapter = stubAdapter("claude");
    registry.register(adapter);
    expect(registry.get("claude")).toBe(adapter);
  });

  it("R2 — has reflects registration state", () => {
    const registry = new AdapterRegistry();
    expect(registry.has("claude")).toBe(false);
    registry.register(stubAdapter("claude"));
    expect(registry.has("claude")).toBe(true);
    expect(registry.has("codex")).toBe(false);
  });

  it("R3 — list contains every registered provider", () => {
    const registry = new AdapterRegistry();
    registry.register(stubAdapter("claude"));
    registry.register(stubAdapter("codex"));
    const providers = registry.list();
    expect(providers).toHaveLength(2);
    expect(providers).toContain("claude");
    expect(providers).toContain("codex");
  });

  it("R4 — unknown provider throws UnknownProviderError", () => {
    const registry = new AdapterRegistry();
    let caught: unknown;
    try {
      registry.get("claude");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(UnknownProviderError);
    const err = caught as UnknownProviderError;
    expect(err.name).toBe("UnknownProviderError");
    expect(err.provider).toBe("claude");
    expect(err.message).toContain("claude");
  });

  it("R5 — re-registering the same provider overwrites the previous adapter", () => {
    const registry = new AdapterRegistry();
    const first = stubAdapter("claude");
    const second = stubAdapter("claude");
    registry.register(first);
    registry.register(second);
    expect(registry.get("claude")).toBe(second);
    expect(registry.list()).toEqual(["claude"]);
  });

  it("R6 — null allowlist (default) accepts any registered provider", () => {
    const registry = new AdapterRegistry();
    registry.register(stubAdapter("claude"));
    expect(registry.getAllowlist()).toBeNull();
    expect(registry.isAllowed("claude")).toBe(true);
    expect(registry.isAllowed("codex")).toBe(true);
    expect(registry.get("claude").provider).toBe("claude");
  });

  it("R7 — get throws ProviderNotAllowedError when provider is outside the allowlist", () => {
    const registry = new AdapterRegistry();
    registry.register(stubAdapter("claude"));
    registry.register(stubAdapter("codex"));
    registry.setAllowlist(["claude"]);
    expect(registry.isAllowed("codex")).toBe(false);

    let caught: unknown;
    try {
      registry.get("codex");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ProviderNotAllowedError);
    const err = caught as ProviderNotAllowedError;
    expect(err.provider).toBe("codex");
    expect(err.allowlist).toEqual(["claude"]);
    expect(err.message).toContain("codex");
  });

  it("R8 — setAllowlist(null) clears the restriction", () => {
    const registry = new AdapterRegistry();
    registry.register(stubAdapter("claude"));
    registry.register(stubAdapter("codex"));
    registry.setAllowlist(["claude"]);
    registry.setAllowlist(null);
    expect(registry.getAllowlist()).toBeNull();
    expect(registry.get("codex").provider).toBe("codex");
  });

  it("R9 — getAllowlist returns a defensive copy", () => {
    const registry = new AdapterRegistry();
    registry.setAllowlist(["claude", "codex"]);
    const snapshot = registry.getAllowlist();
    expect(snapshot).toEqual(["claude", "codex"]);
    snapshot!.pop();
    expect(registry.getAllowlist()).toEqual(["claude", "codex"]);
  });
});
