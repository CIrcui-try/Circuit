import { describe, expect, it } from "vitest";
import type { RunnableEdge } from "./runner";
import { topoSort } from "./topoSort";

const edge = (id: string, source: string, target: string): RunnableEdge => ({
  id,
  source,
  target,
});

describe("topoSort", () => {
  it("TS1: orders a linear chain by dependency", () => {
    const result = topoSort(
      ["a", "b", "c"],
      [edge("e1", "a", "b"), edge("e2", "b", "c")],
    );
    expect(result).toEqual({ cycle: false, order: ["a", "b", "c"] });
  });

  it("TS2: orders a diamond so each successor follows both predecessors", () => {
    const result = topoSort(
      ["a", "b", "c", "d"],
      [
        edge("e1", "a", "b"),
        edge("e2", "a", "c"),
        edge("e3", "b", "d"),
        edge("e4", "c", "d"),
      ],
    );
    if (result.cycle) throw new Error("expected no cycle");
    const idx = (id: string) => result.order.indexOf(id);
    expect(idx("a")).toBeLessThan(idx("b"));
    expect(idx("a")).toBeLessThan(idx("c"));
    expect(idx("b")).toBeLessThan(idx("d"));
    expect(idx("c")).toBeLessThan(idx("d"));
    expect(result.order).toHaveLength(4);
  });

  it("TS3: detects a cycle and returns { cycle: true }", () => {
    const result = topoSort(
      ["a", "b", "c"],
      [edge("e1", "a", "b"), edge("e2", "b", "c"), edge("e3", "c", "a")],
    );
    expect(result).toEqual({ cycle: true });
  });

  it("TS4: includes disconnected nodes in the order", () => {
    const result = topoSort(["a", "b", "c"], [edge("e1", "a", "b")]);
    if (result.cycle) throw new Error("expected no cycle");
    expect(result.order.sort()).toEqual(["a", "b", "c"]);
    expect(result.order.indexOf("a")).toBeLessThan(result.order.indexOf("b"));
  });

  it("TS5: empty input returns empty order", () => {
    expect(topoSort([], [])).toEqual({ cycle: false, order: [] });
  });
});
