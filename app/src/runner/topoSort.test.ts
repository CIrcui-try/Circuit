import { describe, expect, it } from "vitest";
import type { RunnableEdge } from "./runner";
import { analyzeWorkflowGraph, topoSort } from "./topoSort";

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

describe("analyzeWorkflowGraph", () => {
  it("accepts a linear chain and reports its root", () => {
    expect(
      analyzeWorkflowGraph(
        ["a", "b", "c"],
        [edge("e1", "a", "b"), edge("e2", "b", "c")],
      ),
    ).toEqual({ valid: true, hasCycle: false, rootNodeId: "a" });
  });

  it("accepts a diamond graph with one root", () => {
    expect(
      analyzeWorkflowGraph(
        ["a", "b", "c", "d"],
        [
          edge("e1", "a", "b"),
          edge("e2", "a", "c"),
          edge("e3", "b", "d"),
          edge("e4", "c", "d"),
        ],
      ),
    ).toEqual({ valid: true, hasCycle: false, rootNodeId: "a" });
  });

  it("rejects a chain plus an isolated node", () => {
    expect(
      analyzeWorkflowGraph(["a", "b", "c"], [edge("e1", "a", "b")]),
    ).toEqual({
      valid: false,
      hasCycle: false,
      reason: "multiple-roots",
      rootNodeIds: ["a", "c"],
    });
  });

  it("rejects two roots pointing at the same node", () => {
    expect(
      analyzeWorkflowGraph(
        ["a", "b", "c"],
        [edge("e1", "a", "c"), edge("e2", "b", "c")],
      ),
    ).toEqual({
      valid: false,
      hasCycle: false,
      reason: "multiple-roots",
      rootNodeIds: ["a", "b"],
    });
  });

  it("accepts a pure cycle and chooses a stable representative root", () => {
    expect(
      analyzeWorkflowGraph(
        ["a", "b", "c"],
        [edge("e1", "a", "b"), edge("e2", "b", "c"), edge("e3", "c", "a")],
      ),
    ).toEqual({ valid: true, hasCycle: true, rootNodeId: "a" });
  });

  it("rejects a disconnected cycle plus a chain", () => {
    expect(
      analyzeWorkflowGraph(
        ["a", "b", "c", "d"],
        [edge("e1", "a", "b"), edge("e2", "c", "d"), edge("e3", "d", "c")],
      ),
    ).toEqual({
      valid: false,
      hasCycle: true,
      reason: "multiple-roots",
      rootNodeIds: ["a", "c"],
    });
  });

  it("accepts a root that enters a cycle", () => {
    expect(
      analyzeWorkflowGraph(
        ["a", "b", "c"],
        [edge("e1", "a", "b"), edge("e2", "b", "c"), edge("e3", "c", "b")],
      ),
    ).toEqual({ valid: true, hasCycle: true, rootNodeId: "a" });
  });
});
