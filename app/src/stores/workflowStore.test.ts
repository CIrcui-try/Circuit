import { beforeEach, describe, expect, it } from "vitest";
import type { Skill } from "./skillStore";
import {
  DEFAULT_WORKFLOW_NAME,
  WORKFLOW_CYCLE_WARNING_MESSAGE,
  useWorkflowStore,
  type SkillNode,
} from "./workflowStore";
import type { Edge } from "@xyflow/react";

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
      provider: "claude",
      skillFile: ".claude/skills/foo/SKILL.md",
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
    expect(useWorkflowStore.getState().connectionWarning).toBeNull();
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

  it("WS5b: onConnect keeps a cycle edge and surfaces a warning", () => {
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

  it("WS13: resetWorkflow clears workflowName and currentWorkflowId", () => {
    useWorkflowStore.getState().setWorkflowName("Temp");
    useWorkflowStore.setState({ currentWorkflowId: "wf-1" });
    useWorkflowStore.getState().resetWorkflow();
    const s = useWorkflowStore.getState();
    expect(s.workflowName).toBe(DEFAULT_WORKFLOW_NAME);
    expect(s.currentWorkflowId).toBeNull();
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
    });

    const s = useWorkflowStore.getState();
    expect(s.nodes.map((n) => n.id)).toEqual(["uuid-1"]);
    expect(s.edges).toHaveLength(0);
    expect(s.selectedNodeId).toBeNull();
    expect(s.selectedEdgeId).toBeNull();
    expect(s.currentWorkflowId).toBe("wf-loaded");
    expect(s.workflowName).toBe("Loaded flow");
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
});
