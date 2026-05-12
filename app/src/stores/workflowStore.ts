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
import { topoSort } from "../runner/topoSort";
import type { Skill, SkillProvider } from "./skillStore";

export type SkillRef = {
  source?: "repository" | "default" | "system";
  provider: SkillProvider;
  skillFile: string;
  skillFileAbsPath?: string;
  systemSkillId?: string;
};

export type SkillNodeData = {
  label: string;
  description?: string;
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

export type WorkflowConnectionWarning = {
  id: string;
  message: string;
};

type WorkflowState = {
  nodes: SkillNode[];
  edges: Edge[];
  selectedNodeId: string | null;
  selectedEdgeId: string | null;
  workflowName: string;
  currentWorkflowId: string | null;
  connectionWarning: WorkflowConnectionWarning | null;

  onNodesChange: (changes: NodeChange[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  onConnect: (conn: Connection) => void;

  addSkillNode: (skill: Skill, position: XYPosition) => string;
  setNodeInput: (nodeId: string, input: Record<string, unknown> | null) => void;
  selectNode: (id: string | null) => void;
  selectEdge: (id: string | null) => void;
  deleteNode: (nodeId: string) => void;
  deleteSelected: () => void;
  resetWorkflow: () => void;
  setWorkflowName: (name: string) => void;
  replaceCanvas: (args: ReplaceCanvasArgs) => void;
  clearConnectionWarning: (id?: string) => void;
};

export const DEFAULT_WORKFLOW_NAME = "Untitled workflow";
export const WORKFLOW_CYCLE_WARNING_MESSAGE =
  "This workflow may run indefinitely.";

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
  connectionWarning: null,

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
    const nextEdges = addEdge(conn, edges);
    const sorted = topoSort(
      get().nodes.map((n) => n.id),
      nextEdges,
    );
    set({
      edges: nextEdges,
      connectionWarning: sorted.cycle
        ? {
            id: crypto.randomUUID(),
            message: WORKFLOW_CYCLE_WARNING_MESSAGE,
          }
        : get().connectionWarning,
    });
  },

  addSkillNode: (skill, position) => {
    const id = nextNodeId();
    const source = skill.source ?? "repository";
    const node: SkillNode = {
      id,
      type: "skill",
      // Snap to integer pixels so React Flow's translate() never lands on a
      // sub-pixel boundary — otherwise text inside the node renders blurry.
      position: { x: Math.round(position.x), y: Math.round(position.y) },
      data: {
        label: skill.name,
        ...(skill.description ? { description: skill.description } : {}),
        ...(skill.inputHints?.length ? { inputHints: skill.inputHints } : {}),
        skillRef: {
          source,
          provider: skill.provider,
          skillFile: skill.skillFile,
          ...(skill.skillFileAbsPath
            ? { skillFileAbsPath: skill.skillFileAbsPath }
            : {}),
          ...(source === "system"
            ? { systemSkillId: skill.systemSkillId ?? skill.id }
            : {}),
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

  deleteNode: (nodeId) => {
    const { nodes, edges, selectedNodeId, selectedEdgeId } = get();
    const incidentEdgeIds = new Set(
      edges
        .filter((e) => e.source === nodeId || e.target === nodeId)
        .map((e) => e.id),
    );
    set({
      nodes: nodes.filter((n) => n.id !== nodeId),
      edges: edges.filter((e) => !incidentEdgeIds.has(e.id)),
      selectedNodeId: selectedNodeId === nodeId ? null : selectedNodeId,
      selectedEdgeId:
        selectedEdgeId && incidentEdgeIds.has(selectedEdgeId)
          ? null
          : selectedEdgeId,
    });
  },

  deleteSelected: () => {
    const { selectedNodeId, selectedEdgeId, edges } = get();
    if (selectedNodeId) {
      get().deleteNode(selectedNodeId);
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
      connectionWarning: null,
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
      connectionWarning: null,
    });
  },

  clearConnectionWarning: (id) => {
    const { connectionWarning } = get();
    if (!connectionWarning) return;
    if (id && connectionWarning.id !== id) return;
    set({ connectionWarning: null });
  },
}));

// Expose the store so Playwright can drive React Flow connections without
// relying on fragile handle-to-handle pointer drags. The store is the single
// source of truth for nodes/edges, so tests still exercise the real path.
if (typeof window !== "undefined") {
  (window as unknown as { __WORKFLOW_STORE__?: unknown }).__WORKFLOW_STORE__ =
    useWorkflowStore;
}
