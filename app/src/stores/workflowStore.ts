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

type WorkflowHistorySnapshot = {
  nodes: SkillNode[];
  edges: Edge[];
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
  historyPast: WorkflowHistorySnapshot[];
  historyFuture: WorkflowHistorySnapshot[];
  historyBatchSnapshot: WorkflowHistorySnapshot | null;

  onNodesChange: (changes: NodeChange[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  onConnect: (conn: Connection) => void;

  addSkillNode: (skill: Skill, position: XYPosition) => string;
  setNodeInput: (nodeId: string, input: Record<string, unknown> | null) => void;
  setNodeModel: (nodeId: string, model: string | null) => void;
  changeRepositorySkillRef: (args: {
    provider: SkillProvider;
    skillFile: string;
    nextProvider: SkillProvider;
    nextSkillFile: string;
    nextSkillFileAbsPath?: string;
  }) => void;
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
  undo: () => void;
  redo: () => void;
  beginHistoryBatch: () => void;
  endHistoryBatch: () => void;
};

export const DEFAULT_WORKFLOW_NAME = "Untitled workflow";
export const WORKFLOW_CYCLE_WARNING_MESSAGE =
  "This workflow may run indefinitely.";
export const AUTO_LAYOUT_NODE_X_GAP = 340;
export const AUTO_LAYOUT_NODE_Y_GAP = 190;
export const AUTO_LAYOUT_ORIGIN_X = 240;
export const AUTO_LAYOUT_ORIGIN_Y = 100;
const MAX_HISTORY_ENTRIES = 100;

function nextNodeId(): string {
  return crypto.randomUUID();
}

function deriveSelection<T extends { id: string; selected?: boolean }>(
  items: T[],
): string | null {
  return items.find((item) => item.selected)?.id ?? null;
}

function cloneHistoryNode(node: SkillNode): SkillNode {
  return {
    ...node,
    position: { ...node.position },
    data: structuredClone(node.data),
    selected: false,
  };
}

function cloneHistoryEdge(edge: Edge): Edge {
  return {
    ...structuredClone(edge),
    selected: false,
  };
}

function toHistorySnapshot(state: Pick<WorkflowState, "nodes" | "edges">): WorkflowHistorySnapshot {
  return {
    nodes: state.nodes.map(cloneHistoryNode),
    edges: state.edges.map(cloneHistoryEdge),
  };
}

function restoreHistorySnapshot(snapshot: WorkflowHistorySnapshot) {
  return {
    nodes: snapshot.nodes.map(cloneHistoryNode),
    edges: snapshot.edges.map(cloneHistoryEdge),
    selectedNodeId: null,
    selectedEdgeId: null,
    connectionWarning: null,
  };
}

function pushHistory(
  history: WorkflowHistorySnapshot[],
  snapshot: WorkflowHistorySnapshot,
): WorkflowHistorySnapshot[] {
  return [...history, snapshot].slice(-MAX_HISTORY_ENTRIES);
}

function historyPrefix(state: WorkflowState) {
  if (state.historyBatchSnapshot) return {};
  return {
    historyPast: pushHistory(state.historyPast, toHistorySnapshot(state)),
    historyFuture: [],
  };
}

function historyPrefixIfChanged(
  state: WorkflowState,
  nextSnapshot: WorkflowHistorySnapshot,
) {
  if (sameHistorySnapshot(toHistorySnapshot(state), nextSnapshot)) return {};
  return historyPrefix(state);
}

function nodeChangesAffectHistory(changes: NodeChange[]): boolean {
  return changes.some(
    (change) => change.type !== "select" && change.type !== "dimensions",
  );
}

function edgeChangesAffectHistory(changes: EdgeChange[]): boolean {
  return changes.some((change) => change.type !== "select");
}

function sameHistorySnapshot(
  left: WorkflowHistorySnapshot,
  right: WorkflowHistorySnapshot,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
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
  historyPast: [],
  historyFuture: [],
  historyBatchSnapshot: null,

  onNodesChange: (changes) => {
    set((s) => {
      const removedNodeIds = new Set(
        changes
          .filter((change) => change.type === "remove")
          .map((change) => change.id),
      );
      const nextNodes = applyNodeChanges(changes, s.nodes).map((n) =>
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
      const nextEdges =
        removedNodeIds.size > 0
          ? s.edges.filter(
              (edge) =>
                !removedNodeIds.has(edge.source) &&
                !removedNodeIds.has(edge.target),
            )
          : s.edges;
      const nextSnapshot = { nodes: nextNodes, edges: nextEdges };
      return {
        ...(nodeChangesAffectHistory(changes)
          ? historyPrefixIfChanged(s, nextSnapshot)
          : {}),
        nodes: nextNodes,
        edges: nextEdges,
        selectedNodeId: deriveSelection(nextNodes),
        selectedEdgeId:
          s.selectedEdgeId && nextEdges.some((edge) => edge.id === s.selectedEdgeId)
            ? s.selectedEdgeId
            : null,
      };
    });
  },

  onEdgesChange: (changes) => {
    set((s) => {
      const nextEdges = applyEdgeChanges(changes, s.edges);
      const nextSnapshot = { nodes: s.nodes, edges: nextEdges };
      return {
        ...(edgeChangesAffectHistory(changes)
          ? historyPrefixIfChanged(s, nextSnapshot)
          : {}),
        edges: nextEdges,
        selectedEdgeId: deriveSelection(nextEdges),
      };
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
    const nextEdges = addEdge(
      {
        source: conn.source,
        target: conn.target,
        sourceHandle: null,
        targetHandle: null,
      },
      edges,
    );
    const sorted = topoSort(
      get().nodes.map((n) => n.id),
      nextEdges,
    );
    const prunedEdges = sorted.cycle ? nextEdges : removeTransitiveEdges(nextEdges);
    set((s) => ({
      ...historyPrefixIfChanged(s, { nodes: s.nodes, edges: prunedEdges }),
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
    }));
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
    set((s) => {
      const nextNodes = [...s.nodes, node];
      return {
        ...historyPrefixIfChanged(s, { nodes: nextNodes, edges: s.edges }),
        nodes: nextNodes,
      };
    });
    return id;
  },

  setNodeInput: (nodeId, input) => {
    set((s) => {
      const nextNodes = s.nodes.map((n) => {
        if (n.id !== nodeId) return n;
        const data = { ...n.data };
        if (input && Object.keys(input).length > 0) {
          data.input = input;
        } else {
          delete data.input;
        }
        return { ...n, data };
      }) as SkillNode[];
      return {
        ...historyPrefixIfChanged(s, { nodes: nextNodes, edges: s.edges }),
        nodes: nextNodes,
      };
    });
  },

  setNodeModel: (nodeId, model) => {
    const trimmed = model?.trim() ?? "";
    set((s) => {
      const nextNodes = s.nodes.map((n) => {
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
      }) as SkillNode[];
      return {
        ...historyPrefixIfChanged(s, { nodes: nextNodes, edges: s.edges }),
        nodes: nextNodes,
      };
    });
  },

  changeRepositorySkillRef: (args) => {
    set((s) => {
      const nextNodes = s.nodes.map((n) => {
        const source = n.data.skillRef.source ?? "repository";
        if (
          source !== "repository" ||
          n.data.skillRef.provider !== args.provider ||
          n.data.skillRef.skillFile !== args.skillFile
        ) {
          return n;
        }

        const data = { ...n.data };
        const skillRef = {
          ...data.skillRef,
          provider: args.nextProvider,
          skillFile: args.nextSkillFile,
        };
        if (args.nextSkillFileAbsPath) {
          skillRef.skillFileAbsPath = args.nextSkillFileAbsPath;
        } else {
          delete skillRef.skillFileAbsPath;
        }
        data.skillRef = skillRef;
        if (data.execution) {
          const execution = { ...data.execution };
          delete execution.model;
          if (Object.keys(execution).length > 0) {
            data.execution = execution;
          } else {
            delete data.execution;
          }
        }
        return { ...n, data };
      }) as SkillNode[];

      return {
        ...historyPrefixIfChanged(s, { nodes: nextNodes, edges: s.edges }),
        nodes: nextNodes,
      };
    });
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
    const nextNodes = nodes.filter((n) => n.id !== nodeId);
    const nextEdges = edges.filter((e) => !incidentEdgeIds.has(e.id));
    set((s) => ({
      ...historyPrefixIfChanged(s, { nodes: nextNodes, edges: nextEdges }),
      nodes: nextNodes,
      edges: nextEdges,
      selectedNodeId: selectedNodeId === nodeId ? null : selectedNodeId,
      selectedEdgeId:
        selectedEdgeId && incidentEdgeIds.has(selectedEdgeId)
          ? null
          : selectedEdgeId,
    }));
  },

  deleteSelected: () => {
    const { selectedNodeId, selectedEdgeId, edges } = get();
    if (selectedNodeId) {
      get().deleteNode(selectedNodeId);
      return;
    }
    if (selectedEdgeId) {
      const nextEdges = edges.filter((e) => e.id !== selectedEdgeId);
      set((s) => ({
        ...historyPrefixIfChanged(s, { nodes: s.nodes, edges: nextEdges }),
        edges: nextEdges,
        selectedEdgeId: null,
      }));
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
      historyPast: [],
      historyFuture: [],
      historyBatchSnapshot: null,
    });
  },

  setWorkflowName: (name) => {
    set({ workflowName: name });
  },

  setContinueOnFailure: (enabled) => {
    set({ continueOnFailure: enabled });
  },

  autoLayoutWorkflow: () => {
    set((s) => {
      const nextNodes = layoutWorkflowNodes(s.nodes, s.edges);
      return {
        ...historyPrefixIfChanged(s, { nodes: nextNodes, edges: s.edges }),
        nodes: nextNodes,
      };
    });
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
      historyPast: [],
      historyFuture: [],
      historyBatchSnapshot: null,
    });
  },

  clearConnectionWarning: (id) => {
    const { connectionWarning } = get();
    if (!connectionWarning) return;
    if (id && connectionWarning.id !== id) return;
    set({ connectionWarning: null });
  },

  undo: () => {
    const { historyPast } = get();
    const previous = historyPast[historyPast.length - 1];
    if (!previous) return;
    set((s) => ({
      ...restoreHistorySnapshot(previous),
      historyPast: s.historyPast.slice(0, -1),
      historyFuture: [toHistorySnapshot(s), ...s.historyFuture],
      historyBatchSnapshot: null,
    }));
  },

  redo: () => {
    const { historyFuture } = get();
    const next = historyFuture[0];
    if (!next) return;
    set((s) => ({
      ...restoreHistorySnapshot(next),
      historyPast: pushHistory(s.historyPast, toHistorySnapshot(s)),
      historyFuture: s.historyFuture.slice(1),
      historyBatchSnapshot: null,
    }));
  },

  beginHistoryBatch: () => {
    if (get().historyBatchSnapshot) return;
    set((s) => ({ historyBatchSnapshot: toHistorySnapshot(s) }));
  },

  endHistoryBatch: () => {
    const base = get().historyBatchSnapshot;
    if (!base) return;
    const current = toHistorySnapshot(get());
    if (sameHistorySnapshot(base, current)) {
      set({ historyBatchSnapshot: null });
      return;
    }
    set((s) => ({
      historyPast: pushHistory(s.historyPast, base),
      historyFuture: [],
      historyBatchSnapshot: null,
    }));
  },
}));

// Expose the store so Playwright can drive React Flow connections without
// relying on fragile handle-to-handle pointer drags. The store is the single
// source of truth for nodes/edges, so tests still exercise the real path.
if (typeof window !== "undefined") {
  (window as unknown as { __WORKFLOW_STORE__?: unknown }).__WORKFLOW_STORE__ =
    useWorkflowStore;
}
