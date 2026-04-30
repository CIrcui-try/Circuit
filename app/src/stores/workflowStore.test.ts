import { beforeEach, describe, expect, it } from "vitest";
import type { Skill } from "./skillStore";
import { useWorkflowStore } from "./workflowStore";

const claudeSkill: Skill = {
  id: "claude:.claude/skills/foo",
  provider: "claude",
  name: "Foo",
  description: "",
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
    expect(node.data.skillRef).toEqual({
      provider: "claude",
      skillFile: ".claude/skills/foo/SKILL.md",
    });
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
});
