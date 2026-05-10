import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type XYPosition,
} from "@xyflow/react";
import { create } from "zustand";
import type { Skill, SkillProvider } from "./skillStore";

export type SkillRef = {
  provider: SkillProvider;
  skillFile: string;
};

export type SkillNodeData = {
  label: string;
  skillRef: SkillRef;
  [key: string]: unknown;
};

export type SkillNode = Node<SkillNodeData, "skill">;

export type ReplaceCanvasArgs = {
  nodes: SkillNode[];
  edges: Edge[];
  workflowId: string | null;
  workflowName: string;
};

type WorkflowState = {
  nodes: SkillNode[];
  edges: Edge[];
  selectedNodeId: string | null;
  selectedEdgeId: string | null;
  workflowName: string;
  currentWorkflowId: string | null;

  onNodesChange: (changes: NodeChange[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  onConnect: (conn: Connection) => void;

  addSkillNode: (skill: Skill, position: XYPosition) => string;
  setNodeInput: (nodeId: string, input: Record<string, unknown> | null) => void;
  selectNode: (id: string | null) => void;
  selectEdge: (id: string | null) => void;
  deleteSelected: () => void;
  resetWorkflow: () => void;
  setWorkflowName: (name: string) => void;
  replaceCanvas: (args: ReplaceCanvasArgs) => void;
};

export const DEFAULT_WORKFLOW_NAME = "Untitled workflow";

function nextNodeId(): string {
  return crypto.randomUUID();
}

function deriveSelection<T extends { id: string; selected?: boolean }>(
  items: T[],
): string | null {
  return items.find((item) => item.selected)?.id ?? null;
}

export const useWorkflowStore = create<WorkflowState>((set, get) => ({
  nodes: [],
  edges: [],
  selectedNodeId: null,
  selectedEdgeId: null,
  workflowName: DEFAULT_WORKFLOW_NAME,
  currentWorkflowId: null,

  onNodesChange: (changes) => {
    const nextNodes = applyNodeChanges(changes, get().nodes).map((n) =>
      n.position
        ? {
            ...n,
            position: {
              x: Math.round(n.position.x),
              y: Math.round(n.position.y),
            },
          }
        : n,
    ) as SkillNode[];
    set({
      nodes: nextNodes,
      selectedNodeId: deriveSelection(nextNodes),
    });
  },

  onEdgesChange: (changes) => {
    const nextEdges = applyEdgeChanges(changes, get().edges);
    set({
      edges: nextEdges,
      selectedEdgeId: deriveSelection(nextEdges),
    });
  },

  onConnect: (conn) => {
    if (!conn.source || !conn.target) return;
    if (conn.source === conn.target) return;
    const { edges } = get();
    const duplicate = edges.some(
      (e) => e.source === conn.source && e.target === conn.target,
    );
    if (duplicate) return;
    set({ edges: addEdge(conn, edges) });
  },

  addSkillNode: (skill, position) => {
    const id = nextNodeId();
    const node: SkillNode = {
      id,
      type: "skill",
      // Snap to integer pixels so React Flow's translate() never lands on a
      // sub-pixel boundary — otherwise text inside the node renders blurry.
      position: { x: Math.round(position.x), y: Math.round(position.y) },
      data: {
        label: skill.name,
        skillRef: {
          provider: skill.provider,
          skillFile: skill.skillFile,
        },
      },
    };
    set({ nodes: [...get().nodes, node] });
    return id;
  },

  setNodeInput: (nodeId, input) => {
    set((s) => ({
      nodes: s.nodes.map((n) => {
        if (n.id !== nodeId) return n;
        const data = { ...n.data };
        if (input && Object.keys(input).length > 0) {
          data.input = input;
        } else {
          delete data.input;
        }
        return { ...n, data };
      }) as SkillNode[],
    }));
  },

  selectNode: (id) => {
    set((s) => ({
      nodes: s.nodes.map((n) => ({ ...n, selected: n.id === id })) as SkillNode[],
      edges: s.edges.map((e) => ({ ...e, selected: false })),
      selectedNodeId: id,
      selectedEdgeId: null,
    }));
  },

  selectEdge: (id) => {
    set((s) => ({
      nodes: s.nodes.map((n) => ({ ...n, selected: false })) as SkillNode[],
      edges: s.edges.map((e) => ({ ...e, selected: e.id === id })),
      selectedNodeId: null,
      selectedEdgeId: id,
    }));
  },

  deleteSelected: () => {
    const { selectedNodeId, selectedEdgeId, nodes, edges } = get();
    if (selectedNodeId) {
      set({
        nodes: nodes.filter((n) => n.id !== selectedNodeId),
        edges: edges.filter(
          (e) => e.source !== selectedNodeId && e.target !== selectedNodeId,
        ),
        selectedNodeId: null,
      });
      return;
    }
    if (selectedEdgeId) {
      set({
        edges: edges.filter((e) => e.id !== selectedEdgeId),
        selectedEdgeId: null,
      });
    }
  },

  resetWorkflow: () => {
    set({
      nodes: [],
      edges: [],
      selectedNodeId: null,
      selectedEdgeId: null,
      workflowName: DEFAULT_WORKFLOW_NAME,
      currentWorkflowId: null,
    });
  },

  setWorkflowName: (name) => {
    set({ workflowName: name });
  },

  replaceCanvas: ({ nodes, edges, workflowId, workflowName }) => {
    set({
      nodes: nodes.map((n) => ({ ...n, selected: false })) as SkillNode[],
      edges: edges.map((e) => ({ ...e, selected: false })),
      selectedNodeId: null,
      selectedEdgeId: null,
      workflowName,
      currentWorkflowId: workflowId,
    });
  },
}));

// Expose the store so Playwright can drive React Flow connections without
// relying on fragile handle-to-handle pointer drags. The store is the single
// source of truth for nodes/edges, so tests still exercise the real path.
if (typeof window !== "undefined") {
  (window as unknown as { __WORKFLOW_STORE__?: unknown }).__WORKFLOW_STORE__ =
    useWorkflowStore;
}
