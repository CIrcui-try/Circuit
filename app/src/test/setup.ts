import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach } from "vitest";
import { cleanup } from "@testing-library/react";
import { createMockRuntimeBridge } from "../runtime/bridge/RuntimeBridge.mock";

beforeEach(() => {
  if (typeof window !== "undefined" && !window.__CIRCUIT_RUNTIME__) {
    window.__CIRCUIT_RUNTIME__ = createMockRuntimeBridge({
      scenario: () => [
        { event: { type: "error", message: "spawn ENOENT (test default)" } },
      ],
    });
  }
});

afterEach(() => {
  cleanup();
  if (typeof window !== "undefined") {
    delete window.__CIRCUIT_RUNTIME__;
  }
});

if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

if (typeof globalThis.DOMRect === "undefined") {
  // @ts-expect-error minimal polyfill for ReactFlow measurements in jsdom
  globalThis.DOMRect = class {
    static fromRect() {
      return { x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 };
    }
  };
}
