import { describe, it, expect, afterEach } from "vitest";
import { getRuntimeBridge } from "./RuntimeBridge";
import { createMockRuntimeBridge } from "./RuntimeBridge.mock";

describe("getRuntimeBridge / dispatcher", () => {
  afterEach(() => {
    delete (window as { __CIRCUIT_RUNTIME__?: unknown }).__CIRCUIT_RUNTIME__;
  });

  it("returns the injected bridge from window.__CIRCUIT_RUNTIME__ when present", () => {
    const mock = createMockRuntimeBridge();
    window.__CIRCUIT_RUNTIME__ = mock;
    expect(getRuntimeBridge()).toBe(mock);
  });

  it("returns a fallback bridge object when no override is injected", () => {
    expect(typeof getRuntimeBridge().readFile).toBe("function");
    expect(typeof getRuntimeBridge().spawn).toBe("function");
    expect(typeof getRuntimeBridge().cancel).toBe("function");
    expect(typeof getRuntimeBridge().subscribe).toBe("function");
  });
});
