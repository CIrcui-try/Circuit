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
import type { WorkflowNodeExecution } from "../workflow/schema";
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
  execution?: WorkflowNodeExecution;
  [key: string]: unknown;
};

export type SkillNode = Node<SkillNodeData, "skill">;

export type ReplaceCanvasArgs = {
  nodes: SkillNode[];
  edges: Edge[];
  workflowId: string | null;
  workflowName: string;
  continueOnFailure?: boolean;
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
  continueOnFailure: boolean;
  connectionWarning: WorkflowConnectionWarning | null;

  onNodesChange: (changes: NodeChange[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  onConnect: (conn: Connection) => void;

  addSkillNode: (skill: Skill, position: XYPosition) => string;
  setNodeInput: (nodeId: string, input: Record<string, unknown> | null) => void;
  setNodeModel: (nodeId: string, model: string | null) => void;
  selectNode: (id: string | null) => void;
  selectEdge: (id: string | null) => void;
  deleteNode: (nodeId: string) => void;
  deleteSelected: () => void;
  resetWorkflow: () => void;
  setWorkflowName: (name: string) => void;
  setContinueOnFailure: (enabled: boolean) => void;
  autoLayoutWorkflow: () => void;
  replaceCanvas: (args: ReplaceCanvasArgs) => void;
  clearConnectionWarning: (id?: string) => void;
};

export const DEFAULT_WORKFLOW_NAME = "Untitled workflow";
export const WORKFLOW_CYCLE_WARNING_MESSAGE =
  "This workflow may run indefinitely.";
export const AUTO_LAYOUT_NODE_X_GAP = 340;
export const AUTO_LAYOUT_NODE_Y_GAP = 190;
export const AUTO_LAYOUT_ORIGIN_X = 240;
export const AUTO_LAYOUT_ORIGIN_Y = 100;

function nextNodeId(): string {
  return crypto.randomUUID();
}

function deriveSelection<T extends { id: string; selected?: boolean }>(
  items: T[],
): string | null {
  return items.find((item) => item.selected)?.id ?? null;
}

function removeTransitiveEdges(edges: Edge[]): Edge[] {
  return edges.filter(
    (edge) => !hasAlternatePath(edges, edge.source, edge.target, edge.id),
  );
}

function hasAlternatePath(
  edges: Edge[],
  source: string,
  target: string,
  ignoredEdgeId: string,
): boolean {
  const visited = new Set<string>();
  const stack = [source];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (visited.has(current)) continue;
    visited.add(current);
    for (const edge of edges) {
      if (edge.id === ignoredEdgeId || edge.source !== current) continue;
      if (edge.target === target) return true;
      stack.push(edge.target);
    }
  }
  return false;
}

export function layoutWorkflowNodes(
  nodes: readonly SkillNode[],
  edges: readonly Edge[],
): SkillNode[] {
  if (nodes.length === 0) return [];
  const nodeIds = nodes.map((node) => node.id);
  const depthById = calculateLayoutDepths(nodeIds, edges);
  const sorted = topoSort(nodeIds, edges);
  const backEdges = sorted.cycle
    ? partitionBackEdges(nodeIds, getValidLayoutEdges(nodeIds, edges)).backEdges
    : [];
  const order = sorted.cycle ? nodeIds : sorted.order;
  const orderIndex = new Map(order.map((id, index) => [id, index]));
  const depthGroups = new Map<number, string[]>();

  for (const id of nodeIds) {
    const depth = depthById.get(id) ?? 0;
    depthGroups.set(depth, [...(depthGroups.get(depth) ?? []), id]);
  }

  const positions = new Map<string, XYPosition>();
  for (const depth of [...depthGroups.keys()].sort((a, b) => a - b)) {
    const group = [...(depthGroups.get(depth) ?? [])].sort(
      (a, b) => (orderIndex.get(a) ?? 0) - (orderIndex.get(b) ?? 0),
    );
    const centerOffset = (group.length - 1) / 2;
    group.forEach((id, index) => {
      positions.set(id, {
        x: Math.round(AUTO_LAYOUT_ORIGIN_X + (index - centerOffset) * AUTO_LAYOUT_NODE_X_GAP),
        y: Math.round(AUTO_LAYOUT_ORIGIN_Y + depth * AUTO_LAYOUT_NODE_Y_GAP),
      });
    });
  }

  moveLoopTargetsToRightLane(positions, depthById, backEdges);

  return nodes.map((node) => ({
    ...node,
    position: positions.get(node.id) ?? node.position,
  })) as SkillNode[];
}

function getValidLayoutEdges(
  nodeIds: readonly string[],
  edges: readonly Edge[],
): Edge[] {
  const nodeIdSet = new Set(nodeIds);
  return edges.filter(
    (edge) => nodeIdSet.has(edge.source) && nodeIdSet.has(edge.target),
  );
}

function calculateLayoutDepths(
  nodeIds: readonly string[],
  edges: readonly Edge[],
): Map<string, number> {
  const validEdges = getValidLayoutEdges(nodeIds, edges);
  const sorted = topoSort([...nodeIds], validEdges);
  const dagEdges = sorted.cycle
    ? partitionBackEdges(nodeIds, validEdges).dagEdges
    : validEdges;
  const order = sorted.cycle ? nodeIds : sorted.order;
  const depthById = new Map(nodeIds.map((id) => [id, 0]));

  for (const id of order) {
    const sourceDepth = depthById.get(id) ?? 0;
    for (const edge of dagEdges) {
      if (edge.source !== id) continue;
      depthById.set(
        edge.target,
        Math.max(depthById.get(edge.target) ?? 0, sourceDepth + 1),
      );
    }
  }

  return depthById;
}

function moveLoopTargetsToRightLane(
  positions: Map<string, XYPosition>,
  depthById: Map<string, number>,
  backEdges: readonly Edge[],
) {
  const loopTargetIds = new Set<string>();
  for (const edge of backEdges) {
    const sourceDepth = depthById.get(edge.source);
    const targetDepth = depthById.get(edge.target);
    if (sourceDepth == null || targetDepth == null) continue;
    if (sourceDepth <= targetDepth) continue;
    loopTargetIds.add(edge.target);
  }
  if (loopTargetIds.size === 0) return;

  const rightLaneX =
    Math.max(...[...positions.values()].map((position) => position.x)) +
    AUTO_LAYOUT_NODE_X_GAP;
  for (const id of loopTargetIds) {
    const position = positions.get(id);
    if (!position) continue;
    positions.set(id, {
      ...position,
      x: rightLaneX,
    });
  }
}

function partitionBackEdges(
  nodeIds: readonly string[],
  edges: readonly Edge[],
): { dagEdges: Edge[]; backEdges: Edge[] } {
  const outgoing = new Map<string, Edge[]>();
  for (const id of nodeIds) outgoing.set(id, []);
  for (const edge of edges) {
    outgoing.get(edge.source)?.push(edge);
  }

  const state = new Map<string, "visiting" | "visited">();
  const dagEdges: Edge[] = [];
  const backEdges: Edge[] = [];

  const visit = (id: string) => {
    state.set(id, "visiting");
    for (const edge of outgoing.get(id) ?? []) {
      const targetState = state.get(edge.target);
      if (targetState === "visiting") {
        backEdges.push(edge);
        continue;
      }
      dagEdges.push(edge);
      if (!targetState) visit(edge.target);
    }
    state.set(id, "visited");
  };

  for (const id of nodeIds) {
    if (!state.has(id)) visit(id);
  }

  return { dagEdges, backEdges };
}

export const useWorkflowStore = create<WorkflowState>((set, get) => ({
  nodes: [],
  edges: [],
  selectedNodeId: null,
  selectedEdgeId: null,
  workflowName: DEFAULT_WORKFLOW_NAME,
  currentWorkflowId: null,
  continueOnFailure: false,
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
    const baseEdges = edges.filter(
      (e) => e.source !== conn.source && e.target !== conn.target,
    );
    const nextEdges = addEdge(
      {
        source: conn.source,
        target: conn.target,
        sourceHandle: null,
        targetHandle: null,
      },
      baseEdges,
    );
    const sorted = topoSort(
      get().nodes.map((n) => n.id),
      nextEdges,
    );
    const prunedEdges = sorted.cycle ? nextEdges : removeTransitiveEdges(nextEdges);
    set({
      edges: prunedEdges,
      selectedEdgeId:
        get().selectedEdgeId &&
        prunedEdges.some((edge) => edge.id === get().selectedEdgeId)
          ? get().selectedEdgeId
          : null,
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
        ...(skill.defaultInput ? { input: skill.defaultInput } : {}),
        ...(skill.defaultModel ? { execution: { model: skill.defaultModel } } : {}),
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

  setNodeModel: (nodeId, model) => {
    const trimmed = model?.trim() ?? "";
    set((s) => ({
      nodes: s.nodes.map((n) => {
        if (n.id !== nodeId) return n;
        const data = { ...n.data };
        if (trimmed.length > 0) {
          data.execution = { ...(data.execution ?? {}), model: trimmed };
        } else if (data.execution) {
          const execution = { ...data.execution };
          delete execution.model;
          if (Object.keys(execution).length > 0) {
            data.execution = execution;
          } else {
            delete data.execution;
          }
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
      continueOnFailure: false,
      connectionWarning: null,
    });
  },

  setWorkflowName: (name) => {
    set({ workflowName: name });
  },

  setContinueOnFailure: (enabled) => {
    set({ continueOnFailure: enabled });
  },

  autoLayoutWorkflow: () => {
    set((s) => ({
      nodes: layoutWorkflowNodes(s.nodes, s.edges),
    }));
  },

  replaceCanvas: ({
    nodes,
    edges,
    workflowId,
    workflowName,
    continueOnFailure,
  }) => {
    set({
      nodes: nodes.map((n) => ({ ...n, selected: false })) as SkillNode[],
      edges: edges.map((e) => ({ ...e, selected: false })),
      selectedNodeId: null,
      selectedEdgeId: null,
      workflowName,
      currentWorkflowId: workflowId,
      continueOnFailure: continueOnFailure === true,
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
