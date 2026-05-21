import { beforeEach, describe, expect, it } from "vitest";
import type { Skill } from "./skillStore";
import {
  AUTO_LAYOUT_NODE_X_GAP,
  AUTO_LAYOUT_NODE_Y_GAP,
  AUTO_LAYOUT_ORIGIN_X,
  AUTO_LAYOUT_ORIGIN_Y,
  DEFAULT_WORKFLOW_NAME,
  WORKFLOW_CYCLE_WARNING_MESSAGE,
  layoutWorkflowNodes,
  useWorkflowStore,
  type SkillNode,
} from "./workflowStore";
import type { Edge, NodeChange } from "@xyflow/react";

const claudeSkill: Skill = {
  id: "claude:.claude/skills/foo",
  provider: "claude",
  name: "Foo",
  description: "Foo does the important thing",
  rootDir: ".claude/skills/foo",
  skillFile: ".claude/skills/foo/SKILL.md",
};

const codexSkill: Skill = {
  id: "codex:.codex/skills/bar",
  provider: "codex",
  name: "Bar",
  description: "",
  rootDir: ".codex/skills/bar",
  skillFile: ".codex/skills/bar/SKILL.md",
};

function workflowNode(id: string, position: { x: number; y: number }): SkillNode {
  return {
    id,
    type: "skill",
    position,
    data: {
      label: id,
      skillRef: {
        provider: "codex",
        skillFile: `.codex/skills/${id}/SKILL.md`,
      },
    },
  };
}

function edge(id: string, source: string, target: string): Edge {
  return { id, source, target };
}

beforeEach(() => {
  useWorkflowStore.getState().resetWorkflow();
});

describe("workflowStore", () => {
  it("WS1: addSkillNode appends a typed skill node carrying skillRef", () => {
    const id = useWorkflowStore
      .getState()
      .addSkillNode(claudeSkill, { x: 10, y: 20 });
    const node = useWorkflowStore.getState().nodes[0];
    expect(useWorkflowStore.getState().nodes).toHaveLength(1);
    expect(node.id).toBe(id);
    expect(node.type).toBe("skill");
    expect(node.position).toEqual({ x: 10, y: 20 });
    expect(node.data.label).toBe("Foo");
    expect(node.data.description).toBe("Foo does the important thing");
    expect(node.data.skillRef).toEqual({
      source: "repository",
      provider: "claude",
      skillFile: ".claude/skills/foo/SKILL.md",
    });
  });

  it("WS1b: addSkillNode copies default input and model from skill metadata", () => {
    useWorkflowStore.getState().addSkillNode(
      {
        ...codexSkill,
        defaultInput: {
          arguments: "CIR-94",
          prompt: "Check the UI",
        },
        defaultModel: "gpt-5.4",
      },
      { x: 10, y: 20 },
    );

    expect(useWorkflowStore.getState().nodes[0].data.input).toEqual({
      arguments: "CIR-94",
      prompt: "Check the UI",
    });
    expect(useWorkflowStore.getState().nodes[0].data.execution).toEqual({
      model: "gpt-5.4",
    });
  });

  it("WS1c: addSkillNode stores system skill refs by id", () => {
    useWorkflowStore.getState().addSkillNode(
      {
        id: "codex:imagegen",
        provider: "codex",
        source: "system",
        name: "imagegen",
        description: "",
        rootDir: "",
        skillFile: "",
        systemSkillId: "codex:imagegen",
      },
      { x: 0, y: 0 },
    );

    expect(useWorkflowStore.getState().nodes[0].data.skillRef).toEqual({
      source: "system",
      provider: "codex",
      skillFile: "",
      systemSkillId: "codex:imagegen",
    });
  });

  it("WS1b: addSkillNode omits empty descriptions", () => {
    useWorkflowStore.getState().addSkillNode(codexSkill, { x: 0, y: 0 });
    expect(useWorkflowStore.getState().nodes[0].data.description).toBeUndefined();
  });

  it("WS2: onNodesChange position update preserves id and updates position", () => {
    const id = useWorkflowStore
      .getState()
      .addSkillNode(claudeSkill, { x: 0, y: 0 });
    useWorkflowStore.getState().onNodesChange([
      { id, type: "position", position: { x: 50, y: 60 }, dragging: false },
    ]);
    const node = useWorkflowStore.getState().nodes.find((n) => n.id === id);
    expect(node?.position).toEqual({ x: 50, y: 60 });
  });

  it("WS3: onConnect adds an edge between distinct nodes", () => {
    const a = useWorkflowStore.getState().addSkillNode(claudeSkill, { x: 0, y: 0 });
    const b = useWorkflowStore.getState().addSkillNode(codexSkill, { x: 100, y: 0 });
    useWorkflowStore.getState().onConnect({
      source: a,
      target: b,
      sourceHandle: null,
      targetHandle: null,
    });
    expect(useWorkflowStore.getState().edges).toHaveLength(1);
    expect(useWorkflowStore.getState().edges[0]).toMatchObject({
      source: a,
      target: b,
    });
    expect(useWorkflowStore.getState().edges[0]).not.toHaveProperty("sourceHandle");
    expect(useWorkflowStore.getState().edges[0]).not.toHaveProperty("targetHandle");
    expect(useWorkflowStore.getState().connectionWarning).toBeNull();
  });

  it("WS3a: onConnect strips handle ids from loose-mode connections", () => {
    const a = useWorkflowStore.getState().addSkillNode(claudeSkill, { x: 0, y: 0 });
    const b = useWorkflowStore.getState().addSkillNode(codexSkill, { x: 100, y: 0 });

    useWorkflowStore.getState().onConnect({
      source: a,
      target: b,
      sourceHandle: "output-bottom",
      targetHandle: "output-bottom",
    });

    expect(useWorkflowStore.getState().edges[0]).toMatchObject({
      source: a,
      target: b,
    });
    expect(useWorkflowStore.getState().edges[0]).not.toHaveProperty("sourceHandle");
    expect(useWorkflowStore.getState().edges[0]).not.toHaveProperty("targetHandle");
  });

  it("WS4: onConnect rejects self-loops", () => {
    const a = useWorkflowStore.getState().addSkillNode(claudeSkill, { x: 0, y: 0 });
    useWorkflowStore.getState().onConnect({
      source: a,
      target: a,
      sourceHandle: null,
      targetHandle: null,
    });
    expect(useWorkflowStore.getState().edges).toHaveLength(0);
    expect(useWorkflowStore.getState().connectionWarning).toBeNull();
  });

  it("WS5: onConnect rejects duplicate edges (same source+target)", () => {
    const a = useWorkflowStore.getState().addSkillNode(claudeSkill, { x: 0, y: 0 });
    const b = useWorkflowStore.getState().addSkillNode(codexSkill, { x: 100, y: 0 });
    useWorkflowStore.getState().onConnect({
      source: a, target: b, sourceHandle: null, targetHandle: null,
    });
    useWorkflowStore.getState().onConnect({
      source: a, target: b, sourceHandle: null, targetHandle: null,
    });
    expect(useWorkflowStore.getState().edges).toHaveLength(1);
    expect(useWorkflowStore.getState().connectionWarning).toBeNull();
  });

  it("WS5a: onConnect keeps multiple outgoing edges from one source", () => {
    const a = useWorkflowStore.getState().addSkillNode(claudeSkill, { x: 0, y: 0 });
    const b = useWorkflowStore.getState().addSkillNode(codexSkill, { x: 100, y: 0 });
    const c = useWorkflowStore.getState().addSkillNode(claudeSkill, { x: 200, y: 0 });
    useWorkflowStore.getState().onConnect({
      source: a, target: b, sourceHandle: null, targetHandle: null,
    });
    useWorkflowStore.getState().onConnect({
      source: a, target: c, sourceHandle: null, targetHandle: null,
    });

    expect(
      useWorkflowStore.getState().edges.map((edge) => [edge.source, edge.target]),
    ).toEqual([
      [a, b],
      [a, c],
    ]);
    expect(useWorkflowStore.getState().connectionWarning).toBeNull();
  });

  it("WS5b: onConnect removes edges that become transitive later", () => {
    const a = useWorkflowStore.getState().addSkillNode(claudeSkill, { x: 0, y: 0 });
    const b = useWorkflowStore.getState().addSkillNode(codexSkill, { x: 100, y: 0 });
    const c = useWorkflowStore.getState().addSkillNode(claudeSkill, { x: 200, y: 0 });
    useWorkflowStore.getState().onConnect({
      source: a, target: c, sourceHandle: null, targetHandle: null,
    });
    useWorkflowStore.getState().onConnect({
      source: a, target: b, sourceHandle: null, targetHandle: null,
    });
    useWorkflowStore.getState().onConnect({
      source: b, target: c, sourceHandle: null, targetHandle: null,
    });

    expect(
      useWorkflowStore.getState().edges.map((edge) => [edge.source, edge.target]),
    ).toEqual([
      [a, b],
      [b, c],
    ]);
    expect(useWorkflowStore.getState().connectionWarning).toBeNull();
  });

  it("WS5c: onConnect keeps selected edge when adding another outgoing edge", () => {
    const a = useWorkflowStore.getState().addSkillNode(claudeSkill, { x: 0, y: 0 });
    const b = useWorkflowStore.getState().addSkillNode(codexSkill, { x: 100, y: 0 });
    const c = useWorkflowStore.getState().addSkillNode(claudeSkill, { x: 200, y: 0 });
    useWorkflowStore.getState().onConnect({
      source: a, target: b, sourceHandle: null, targetHandle: null,
    });
    const firstEdgeId = useWorkflowStore.getState().edges[0].id;
    useWorkflowStore.getState().selectEdge(firstEdgeId);

    useWorkflowStore.getState().onConnect({
      source: a, target: c, sourceHandle: null, targetHandle: null,
    });

    expect(
      useWorkflowStore.getState().edges.map((edge) => [edge.source, edge.target]),
    ).toEqual([
      [a, b],
      [a, c],
    ]);
    expect(useWorkflowStore.getState().selectedEdgeId).toBe(firstEdgeId);
    expect(useWorkflowStore.getState().connectionWarning).toBeNull();
  });

  it("WS5d: onConnect keeps multiple incoming edges into one target", () => {
    const a = useWorkflowStore.getState().addSkillNode(claudeSkill, { x: 0, y: 0 });
    const b = useWorkflowStore.getState().addSkillNode(codexSkill, { x: 100, y: 0 });
    const c = useWorkflowStore.getState().addSkillNode(claudeSkill, { x: 200, y: 0 });
    useWorkflowStore.getState().onConnect({
      source: a, target: c, sourceHandle: null, targetHandle: null,
    });

    useWorkflowStore.getState().onConnect({
      source: b, target: c, sourceHandle: null, targetHandle: null,
    });

    expect(
      useWorkflowStore.getState().edges.map((edge) => [edge.source, edge.target]),
    ).toEqual([
      [a, c],
      [b, c],
    ]);
    expect(useWorkflowStore.getState().connectionWarning).toBeNull();
  });

  it("WS5e: onConnect keeps a cycle edge and surfaces a warning", () => {
    const a = useWorkflowStore.getState().addSkillNode(claudeSkill, { x: 0, y: 0 });
    const b = useWorkflowStore.getState().addSkillNode(codexSkill, { x: 100, y: 0 });
    useWorkflowStore.getState().onConnect({
      source: a, target: b, sourceHandle: null, targetHandle: null,
    });
    useWorkflowStore.getState().onConnect({
      source: b, target: a, sourceHandle: null, targetHandle: null,
    });

    expect(useWorkflowStore.getState().edges).toHaveLength(2);
    expect(useWorkflowStore.getState().edges[1]).toMatchObject({
      source: b,
      target: a,
    });
    expect(useWorkflowStore.getState().connectionWarning).toMatchObject({
      message: WORKFLOW_CYCLE_WARNING_MESSAGE,
    });
  });

  it("WS5f: onConnect keeps original incoming edge when adding a loop-entry edge", () => {
    const root = useWorkflowStore
      .getState()
      .addSkillNode(claudeSkill, { x: 0, y: 0 });
    const entry = useWorkflowStore
      .getState()
      .addSkillNode(codexSkill, { x: 100, y: 0 });
    const body = useWorkflowStore
      .getState()
      .addSkillNode(claudeSkill, { x: 200, y: 0 });
    const tail = useWorkflowStore
      .getState()
      .addSkillNode(codexSkill, { x: 300, y: 0 });

    useWorkflowStore.getState().onConnect({
      source: root, target: entry, sourceHandle: null, targetHandle: null,
    });
    useWorkflowStore.getState().onConnect({
      source: entry, target: body, sourceHandle: null, targetHandle: null,
    });
    useWorkflowStore.getState().onConnect({
      source: body, target: tail, sourceHandle: null, targetHandle: null,
    });
    useWorkflowStore.getState().onConnect({
      source: tail, target: entry, sourceHandle: null, targetHandle: null,
    });

    expect(
      useWorkflowStore.getState().edges.map((edge) => [edge.source, edge.target]),
    ).toEqual([
      [root, entry],
      [entry, body],
      [body, tail],
      [tail, entry],
    ]);
    expect(useWorkflowStore.getState().connectionWarning).toMatchObject({
      message: WORKFLOW_CYCLE_WARNING_MESSAGE,
    });
  });

  it("WS6: deleteSelected removes selected node AND incident edges", () => {
    const a = useWorkflowStore.getState().addSkillNode(claudeSkill, { x: 0, y: 0 });
    const b = useWorkflowStore.getState().addSkillNode(codexSkill, { x: 100, y: 0 });
    useWorkflowStore.getState().onConnect({
      source: a, target: b, sourceHandle: null, targetHandle: null,
    });
    useWorkflowStore.getState().selectNode(a);

    expect(useWorkflowStore.getState().selectedNodeId).toBe(a);

    useWorkflowStore.getState().deleteSelected();

    const { nodes, edges, selectedNodeId } = useWorkflowStore.getState();
    expect(nodes.map((n) => n.id)).toEqual([b]);
    expect(edges).toHaveLength(0);
    expect(selectedNodeId).toBeNull();
  });

  it("WS7: deleteSelected with selected edge removes only the edge", () => {
    const a = useWorkflowStore.getState().addSkillNode(claudeSkill, { x: 0, y: 0 });
    const b = useWorkflowStore.getState().addSkillNode(codexSkill, { x: 100, y: 0 });
    useWorkflowStore.getState().onConnect({
      source: a, target: b, sourceHandle: null, targetHandle: null,
    });
    const edgeId = useWorkflowStore.getState().edges[0].id;
    useWorkflowStore.getState().selectEdge(edgeId);

    useWorkflowStore.getState().deleteSelected();

    const { nodes, edges, selectedEdgeId } = useWorkflowStore.getState();
    expect(nodes).toHaveLength(2);
    expect(edges).toHaveLength(0);
    expect(selectedEdgeId).toBeNull();
  });

  it("WS7b: deleteNode removes the node, incident edges, and stale selection", () => {
    const a = useWorkflowStore.getState().addSkillNode(claudeSkill, { x: 0, y: 0 });
    const b = useWorkflowStore.getState().addSkillNode(codexSkill, { x: 100, y: 0 });
    useWorkflowStore.getState().onConnect({
      source: a, target: b, sourceHandle: null, targetHandle: null,
    });
    const edgeId = useWorkflowStore.getState().edges[0].id;
    useWorkflowStore.getState().selectEdge(edgeId);

    useWorkflowStore.getState().deleteNode(a);

    const { nodes, edges, selectedEdgeId } = useWorkflowStore.getState();
    expect(nodes.map((n) => n.id)).toEqual([b]);
    expect(edges).toHaveLength(0);
    expect(selectedEdgeId).toBeNull();
  });

  it("WS8: resetWorkflow clears nodes, edges, and selection", () => {
    const a = useWorkflowStore.getState().addSkillNode(claudeSkill, { x: 0, y: 0 });
    useWorkflowStore.getState().selectNode(a);
    useWorkflowStore.getState().resetWorkflow();
    const s = useWorkflowStore.getState();
    expect(s.nodes).toHaveLength(0);
    expect(s.edges).toHaveLength(0);
    expect(s.selectedNodeId).toBeNull();
    expect(s.selectedEdgeId).toBeNull();
  });

  it("WS9: selectNode flag mirrors selectedNodeId across nodes", () => {
    const a = useWorkflowStore.getState().addSkillNode(claudeSkill, { x: 0, y: 0 });
    const b = useWorkflowStore.getState().addSkillNode(codexSkill, { x: 100, y: 0 });
    useWorkflowStore.getState().selectNode(b);
    const nodes = useWorkflowStore.getState().nodes;
    expect(nodes.find((n) => n.id === a)?.selected).toBe(false);
    expect(nodes.find((n) => n.id === b)?.selected).toBe(true);
  });

  it("WS10: onNodesChange select event mirrors into selectedNodeId", () => {
    const a = useWorkflowStore.getState().addSkillNode(claudeSkill, { x: 0, y: 0 });
    useWorkflowStore.getState().onNodesChange([{ id: a, type: "select", selected: true }]);
    expect(useWorkflowStore.getState().selectedNodeId).toBe(a);

    useWorkflowStore.getState().onNodesChange([{ id: a, type: "select", selected: false }]);
    expect(useWorkflowStore.getState().selectedNodeId).toBeNull();
  });

  it("WS11: addSkillNode generates non-colliding string IDs", () => {
    const a = useWorkflowStore.getState().addSkillNode(claudeSkill, { x: 0, y: 0 });
    const b = useWorkflowStore.getState().addSkillNode(codexSkill, { x: 0, y: 0 });
    expect(typeof a).toBe("string");
    expect(typeof b).toBe("string");
    expect(a).not.toBe(b);
  });

  it("WS12: setWorkflowName updates workflowName", () => {
    useWorkflowStore.getState().setWorkflowName("My flow");
    expect(useWorkflowStore.getState().workflowName).toBe("My flow");
  });

  it("WS13: resetWorkflow clears workflowName, currentWorkflowId, and settings", () => {
    useWorkflowStore.getState().setWorkflowName("Temp");
    useWorkflowStore.getState().setContinueOnFailure(true);
    useWorkflowStore.setState({ currentWorkflowId: "wf-1" });
    useWorkflowStore.getState().resetWorkflow();
    const s = useWorkflowStore.getState();
    expect(s.workflowName).toBe(DEFAULT_WORKFLOW_NAME);
    expect(s.currentWorkflowId).toBeNull();
    expect(s.continueOnFailure).toBe(false);
    expect(s.connectionWarning).toBeNull();
  });

  it("WS14: replaceCanvas overwrites nodes/edges and clears prior selection", () => {
    const a = useWorkflowStore.getState().addSkillNode(claudeSkill, { x: 0, y: 0 });
    useWorkflowStore.getState().selectNode(a);
    expect(useWorkflowStore.getState().selectedNodeId).toBe(a);

    const newNodes: SkillNode[] = [
      {
        id: "uuid-1",
        type: "skill",
        position: { x: 5, y: 6 },
        data: {
          label: "Loaded",
          skillRef: {
            provider: "claude",
            skillFile: ".claude/skills/loaded/SKILL.md",
          },
        },
      },
    ];
    const newEdges: Edge[] = [];

    useWorkflowStore.getState().replaceCanvas({
      nodes: newNodes,
      edges: newEdges,
      workflowId: "wf-loaded",
      workflowName: "Loaded flow",
      continueOnFailure: true,
    });

    const s = useWorkflowStore.getState();
    expect(s.nodes.map((n) => n.id)).toEqual(["uuid-1"]);
    expect(s.edges).toHaveLength(0);
    expect(s.selectedNodeId).toBeNull();
    expect(s.selectedEdgeId).toBeNull();
    expect(s.currentWorkflowId).toBe("wf-loaded");
    expect(s.workflowName).toBe("Loaded flow");
    expect(s.continueOnFailure).toBe(true);
  });

  it("WS14b: setContinueOnFailure updates the workflow setting", () => {
    useWorkflowStore.getState().setContinueOnFailure(true);
    expect(useWorkflowStore.getState().continueOnFailure).toBe(true);
  });

  it("WS14c: autoLayoutWorkflow aligns DAG depth vertically and side branches horizontally", () => {
    const nodes = [
      workflowNode("root", { x: 900, y: 20 }),
      workflowNode("main", { x: -40, y: 800 }),
      workflowNode("side", { x: 460, y: -120 }),
      workflowNode("join", { x: 10, y: 10 }),
    ];
    const edges: Edge[] = [
      edge("e-root-main", "root", "main"),
      edge("e-root-side", "root", "side"),
      edge("e-main-join", "main", "join"),
      edge("e-side-join", "side", "join"),
    ];

    useWorkflowStore.getState().replaceCanvas({
      nodes,
      edges,
      workflowId: "wf",
      workflowName: "Flow",
    });
    useWorkflowStore.getState().autoLayoutWorkflow();

    const byId = new Map(
      useWorkflowStore.getState().nodes.map((node) => [node.id, node]),
    );
    expect(byId.get("root")?.position).toEqual({
      x: AUTO_LAYOUT_ORIGIN_X,
      y: AUTO_LAYOUT_ORIGIN_Y,
    });
    expect(byId.get("main")?.position.y).toBe(
      AUTO_LAYOUT_ORIGIN_Y + AUTO_LAYOUT_NODE_Y_GAP,
    );
    expect(byId.get("side")?.position.y).toBe(
      AUTO_LAYOUT_ORIGIN_Y + AUTO_LAYOUT_NODE_Y_GAP,
    );
    expect(Math.abs(
      (byId.get("main")?.position.x ?? 0) -
        (byId.get("side")?.position.x ?? 0),
    )).toBe(AUTO_LAYOUT_NODE_X_GAP);
    expect(byId.get("join")?.position).toEqual({
      x: AUTO_LAYOUT_ORIGIN_X,
      y: AUTO_LAYOUT_ORIGIN_Y + AUTO_LAYOUT_NODE_Y_GAP * 2,
    });
  });

  it("WS14d: layoutWorkflowNodes ignores cycle-closing edges when placing loop graphs", () => {
    const laidOut = layoutWorkflowNodes(
      [
        workflowNode("a", { x: 0, y: 0 }),
        workflowNode("b", { x: 0, y: 0 }),
        workflowNode("c", { x: 0, y: 0 }),
      ],
      [
        edge("e1", "a", "b"),
        edge("e2", "b", "c"),
        edge("e3", "c", "b"),
      ],
    );
    const byId = new Map(laidOut.map((node) => [node.id, node]));

    expect(byId.get("a")?.position.y).toBe(AUTO_LAYOUT_ORIGIN_Y);
    expect(byId.get("b")?.position.y).toBe(
      AUTO_LAYOUT_ORIGIN_Y + AUTO_LAYOUT_NODE_Y_GAP,
    );
    expect(byId.get("c")?.position.y).toBe(
      AUTO_LAYOUT_ORIGIN_Y + AUTO_LAYOUT_NODE_Y_GAP * 2,
    );
  });

  it("WS14e: layoutWorkflowNodes moves loop targets into a side lane", () => {
    const laidOut = layoutWorkflowNodes(
      [
        workflowNode("planning", { x: 0, y: 0 }),
        workflowNode("implement-plan", { x: 0, y: 0 }),
        workflowNode("review-and-fix", { x: 0, y: 0 }),
        workflowNode("wrap-up", { x: 0, y: 0 }),
      ],
      [
        edge("e1", "planning", "implement-plan"),
        edge("e2", "implement-plan", "review-and-fix"),
        edge("e3", "review-and-fix", "wrap-up"),
        edge("e4", "wrap-up", "planning"),
      ],
    );
    const byId = new Map(laidOut.map((node) => [node.id, node]));

    expect(byId.get("planning")?.position.y).toBe(AUTO_LAYOUT_ORIGIN_Y);
    expect(byId.get("implement-plan")?.position).toEqual({
      x: AUTO_LAYOUT_ORIGIN_X,
      y: AUTO_LAYOUT_ORIGIN_Y + AUTO_LAYOUT_NODE_Y_GAP,
    });
    expect(byId.get("review-and-fix")?.position).toEqual({
      x: AUTO_LAYOUT_ORIGIN_X,
      y: AUTO_LAYOUT_ORIGIN_Y + AUTO_LAYOUT_NODE_Y_GAP * 2,
    });
    expect(byId.get("wrap-up")?.position).toEqual({
      x: AUTO_LAYOUT_ORIGIN_X,
      y: AUTO_LAYOUT_ORIGIN_Y + AUTO_LAYOUT_NODE_Y_GAP * 3,
    });
    expect(byId.get("planning")?.position.x).toBe(
      AUTO_LAYOUT_ORIGIN_X + AUTO_LAYOUT_NODE_X_GAP,
    );
  });

  it("WS15: setNodeInput stores input on the targeted node only", () => {
    const a = useWorkflowStore.getState().addSkillNode(claudeSkill, { x: 0, y: 0 });
    const b = useWorkflowStore.getState().addSkillNode(codexSkill, { x: 100, y: 0 });

    useWorkflowStore.getState().setNodeInput(a, {
      arguments: "CIR-42 --force",
    });

    const nodes = useWorkflowStore.getState().nodes;
    expect(nodes.find((n) => n.id === a)?.data.input).toEqual({
      arguments: "CIR-42 --force",
    });
    expect(nodes.find((n) => n.id === b)?.data.input).toBeUndefined();
  });

  it("WS16: setNodeInput deletes input when given null or an empty object", () => {
    const id = useWorkflowStore.getState().addSkillNode(claudeSkill, { x: 0, y: 0 });

    useWorkflowStore.getState().setNodeInput(id, { arguments: "CIR-42" });
    useWorkflowStore.getState().setNodeInput(id, {});

    expect(useWorkflowStore.getState().nodes[0].data.input).toBeUndefined();

    useWorkflowStore.getState().setNodeInput(id, { arguments: "CIR-42" });
    useWorkflowStore.getState().setNodeInput(id, null);

    expect(useWorkflowStore.getState().nodes[0].data.input).toBeUndefined();
  });

  it("WS17: undo and redo restore added workflow nodes", () => {
    const id = useWorkflowStore
      .getState()
      .addSkillNode(claudeSkill, { x: 10, y: 20 });

    useWorkflowStore.getState().undo();
    expect(useWorkflowStore.getState().nodes).toHaveLength(0);

    useWorkflowStore.getState().redo();
    expect(useWorkflowStore.getState().nodes.map((node) => node.id)).toEqual([id]);
  });

  it("WS18: undo and redo restore workflow edges", () => {
    const a = useWorkflowStore.getState().addSkillNode(claudeSkill, { x: 0, y: 0 });
    const b = useWorkflowStore.getState().addSkillNode(codexSkill, { x: 100, y: 0 });
    useWorkflowStore.getState().onConnect({
      source: a,
      target: b,
      sourceHandle: null,
      targetHandle: null,
    });

    expect(useWorkflowStore.getState().edges).toHaveLength(1);
    useWorkflowStore.getState().undo();
    expect(useWorkflowStore.getState().edges).toHaveLength(0);

    useWorkflowStore.getState().redo();
    expect(useWorkflowStore.getState().edges[0]).toMatchObject({
      source: a,
      target: b,
    });
  });

  it("WS19: undo restores a deleted node and its incident edges", () => {
    const a = useWorkflowStore.getState().addSkillNode(claudeSkill, { x: 0, y: 0 });
    const b = useWorkflowStore.getState().addSkillNode(codexSkill, { x: 100, y: 0 });
    useWorkflowStore.getState().onConnect({
      source: a,
      target: b,
      sourceHandle: null,
      targetHandle: null,
    });

    useWorkflowStore.getState().onNodesChange([{ id: a, type: "remove" }]);
    expect(useWorkflowStore.getState().nodes.map((node) => node.id)).toEqual([b]);
    expect(useWorkflowStore.getState().edges).toHaveLength(0);

    useWorkflowStore.getState().undo();
    expect(useWorkflowStore.getState().nodes.map((node) => node.id)).toEqual([
      a,
      b,
    ]);
    expect(useWorkflowStore.getState().edges).toHaveLength(1);
  });

  it("WS20: auto layout and node input/model changes are undoable", () => {
    const a = useWorkflowStore.getState().addSkillNode(claudeSkill, { x: 500, y: 500 });
    const b = useWorkflowStore.getState().addSkillNode(codexSkill, { x: -100, y: -100 });
    useWorkflowStore.getState().onConnect({
      source: a,
      target: b,
      sourceHandle: null,
      targetHandle: null,
    });

    useWorkflowStore.getState().autoLayoutWorkflow();
    expect(useWorkflowStore.getState().nodes.find((node) => node.id === a)?.position).toEqual({
      x: AUTO_LAYOUT_ORIGIN_X,
      y: AUTO_LAYOUT_ORIGIN_Y,
    });
    useWorkflowStore.getState().undo();
    expect(useWorkflowStore.getState().nodes.find((node) => node.id === a)?.position).toEqual({
      x: 500,
      y: 500,
    });

    useWorkflowStore.getState().setNodeInput(a, { arguments: "CIR-122" });
    useWorkflowStore.getState().setNodeModel(a, "gpt-5.4");
    expect(useWorkflowStore.getState().nodes.find((node) => node.id === a)?.data.input).toEqual({
      arguments: "CIR-122",
    });
    expect(useWorkflowStore.getState().nodes.find((node) => node.id === a)?.data.execution).toEqual({
      model: "gpt-5.4",
    });

    useWorkflowStore.getState().undo();
    expect(useWorkflowStore.getState().nodes.find((node) => node.id === a)?.data.execution).toBeUndefined();
    useWorkflowStore.getState().undo();
    expect(useWorkflowStore.getState().nodes.find((node) => node.id === a)?.data.input).toBeUndefined();
    useWorkflowStore.getState().redo();
    expect(useWorkflowStore.getState().nodes.find((node) => node.id === a)?.data.input).toEqual({
      arguments: "CIR-122",
    });
  });

  it("WS21: batched edits collapse into one undo step", () => {
    const id = useWorkflowStore.getState().addSkillNode(claudeSkill, { x: 0, y: 0 });

    useWorkflowStore.getState().beginHistoryBatch();
    useWorkflowStore.getState().setNodeInput(id, { arguments: "CIR" });
    useWorkflowStore.getState().setNodeInput(id, { arguments: "CIR-122" });
    useWorkflowStore.getState().endHistoryBatch();

    expect(useWorkflowStore.getState().historyPast).toHaveLength(2);
    useWorkflowStore.getState().undo();
    expect(useWorkflowStore.getState().nodes[0].data.input).toBeUndefined();
  });

  it("WS22: selection and dimension updates do not create undo history", () => {
    const id = useWorkflowStore.getState().addSkillNode(claudeSkill, { x: 0, y: 0 });
    useWorkflowStore.getState().undo();
    useWorkflowStore.getState().redo();
    expect(useWorkflowStore.getState().historyPast).toHaveLength(1);

    useWorkflowStore.getState().onNodesChange([
      { id, type: "select", selected: true },
      { id, type: "dimensions", dimensions: { width: 200, height: 100 } },
    ] as NodeChange[]);

    expect(useWorkflowStore.getState().historyPast).toHaveLength(1);
  });

  it("WS23: replaceCanvas and resetWorkflow clear undo history", () => {
    const node = workflowNode("loaded", { x: 0, y: 0 });
    useWorkflowStore.getState().addSkillNode(claudeSkill, { x: 0, y: 0 });
    expect(useWorkflowStore.getState().historyPast).toHaveLength(1);

    useWorkflowStore.getState().replaceCanvas({
      nodes: [node],
      edges: [],
      workflowId: "wf",
      workflowName: "Loaded",
    });
    expect(useWorkflowStore.getState().historyPast).toHaveLength(0);
    useWorkflowStore.getState().undo();
    expect(useWorkflowStore.getState().nodes.map((n) => n.id)).toEqual(["loaded"]);

    useWorkflowStore.getState().addSkillNode(codexSkill, { x: 0, y: 0 });
    expect(useWorkflowStore.getState().historyPast).toHaveLength(1);
    useWorkflowStore.getState().resetWorkflow();
    expect(useWorkflowStore.getState().historyPast).toHaveLength(0);
  });
});
