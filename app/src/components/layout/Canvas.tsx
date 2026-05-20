import {
  Background,
  ConnectionMode,
  Controls,
  MarkerType,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Connection,
  type DefaultEdgeOptions,
  type Edge as RFEdge,
  type FinalConnectionState,
  type Node as RFNode,
  type NodeOrigin,
  type XYPosition,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { openPath, revealItemInDir } from "@tauri-apps/plugin-opener";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { useShallow } from "zustand/react/shallow";
import { nodeTypes } from "../canvas/SkillNode";
import {
  DEPENDENCY_NODE_FALLBACK_HEIGHT,
  DEPENDENCY_NODE_FALLBACK_WIDTH,
  edgeTypes,
  getDependencyRouteForRects,
  readDependencyRouteSlotData,
  toDependencyEndpointHint,
  type DependencyEndpointHint,
  type DependencyNodeRect,
} from "../canvas/DependencyEdge";
import {
  SkillNodeMenu,
  type SkillNodeMenuItem,
} from "../canvas/SkillNodeMenu";
import { useRepositoryStore } from "../../stores/repositoryStore";
import { useSkillStore } from "../../stores/skillStore";
import {
  useWorkflowStore,
  type SkillNode as SkillNodeType,
} from "../../stores/workflowStore";
import type { SkillInputHint } from "../../host/bridge";
import { defaultSkillFileForLegacySystemId } from "../../skills/defaultSkillFiles";
import { analyzeWorkflowGraph } from "../../runner/topoSort";

export const SKILL_DRAG_MIME = "application/x-circuit-skill";
export const CANVAS_NODE_ORIGIN: NodeOrigin = [0.5, 0.5];
export const CANVAS_MAX_ZOOM = 2;
export const CANVAS_FIT_VIEW_OPTIONS = { maxZoom: 1, padding: 0.25 };
export const CANVAS_EDGE_MARKER: NonNullable<RFEdge["markerEnd"]> = {
  type: MarkerType.ArrowClosed,
  color: "#8790a0",
  width: 20,
  height: 20,
};
export const CANVAS_SELECTED_EDGE_MARKER: NonNullable<RFEdge["markerEnd"]> = {
  ...CANVAS_EDGE_MARKER,
  color: "#9fc7ff",
};
export const CANVAS_DEFAULT_EDGE_OPTIONS: DefaultEdgeOptions = {
  type: "dependency",
  markerEnd: CANVAS_EDGE_MARKER,
  interactionWidth: 18,
};
export const CANVAS_CONNECTION_MODE = ConnectionMode.Loose;
const HANDLE_OVERLAP_THRESHOLD = 10;
const HANDLE_OVERLAP_OFFSET = 7;
const DEFAULT_SOURCE_HANDLE_HINT: DependencyEndpointHint = {
  side: "bottom",
  offset: 0,
};
const DEFAULT_TARGET_HANDLE_HINT: DependencyEndpointHint = {
  side: "top",
  offset: 0,
};

export function toCanvasDropPosition(
  screenToFlowPosition: (position: XYPosition) => XYPosition,
  event: Pick<DragEvent<HTMLDivElement>, "clientX" | "clientY">,
): XYPosition {
  return screenToFlowPosition({
    x: event.clientX,
    y: event.clientY,
  });
}

type SkillDragPayload = {
  provider: "claude" | "codex";
  source?: "repository" | "default" | "system";
  skillFile: string;
  skillFileAbsPath?: string;
  systemSkillId?: string;
  name: string;
  description?: string;
  inputHints?: SkillInputHint[];
  defaultInput?: Record<string, string>;
  defaultModel?: string;
};

type MenuState = {
  x: number;
  y: number;
  nodeId: string;
  skillFile: string;
  source?: "repository" | "default" | "system";
  skillFileAbsPath?: string;
  systemSkillId?: string;
};

function joinPath(base: string, rel: string): string {
  return `${base.replace(/\/+$/, "")}/${rel.replace(/^\/+/, "")}`;
}

function resolveSkillFilePath(
  menu: MenuState,
  repoPath: string | null,
  defaultSkills: ReturnType<typeof useSkillStore.getState>["defaultSkills"],
): string | null {
  if (menu.source === "default") {
    return (
      menu.skillFileAbsPath ??
      defaultSkills.find((skill) => skill.skillFile === menu.skillFile)
        ?.skillFileAbsPath ??
      null
    );
  }
  if (menu.source === "system") {
    const defaultSkillFile = defaultSkillFileForLegacySystemId(menu.systemSkillId);
    return (
      defaultSkills.find((skill) => skill.skillFile === defaultSkillFile)
        ?.skillFileAbsPath ?? null
    );
  }
  return repoPath && menu.skillFile ? joinPath(repoPath, menu.skillFile) : null;
}

export function toRenderedCanvasEdges(edges: RFEdge[]): RFEdge[] {
  const outgoing = toEdgeSlotMap(edges, "source");
  const incoming = toEdgeSlotMap(edges, "target");

  return edges.map((edge) => ({
    ...edge,
    type: "dependency",
    data: {
      ...edge.data,
      routeSlot: {
        source: outgoing.get(edge.id) ?? { index: 0, count: 1 },
        target: incoming.get(edge.id) ?? { index: 0, count: 1 },
      },
    },
    markerEnd:
      edge.markerEnd ??
      (edge.selected ? CANVAS_SELECTED_EDGE_MARKER : CANVAS_EDGE_MARKER),
  }));
}

function toEdgeSlotMap(
  edges: RFEdge[],
  key: "source" | "target",
): Map<string, { index: number; count: number }> {
  const groups = new Map<string, RFEdge[]>();
  for (const edge of edges) {
    groups.set(edge[key], [...(groups.get(edge[key]) ?? []), edge]);
  }

  const slots = new Map<string, { index: number; count: number }>();
  for (const group of groups.values()) {
    const sorted = [...group].sort((a, b) => {
      const aOther = key === "source" ? a.target : a.source;
      const bOther = key === "source" ? b.target : b.source;
      return `${aOther}:${a.id}`.localeCompare(`${bOther}:${b.id}`);
    });
    sorted.forEach((edge, index) => {
      slots.set(edge.id, { index, count: sorted.length });
    });
  }
  return slots;
}

type EdgeHandleHints = {
  source?: DependencyEndpointHint;
  target?: DependencyEndpointHint;
};

type ConnectEndEvent = MouseEvent | TouchEvent;

function toEdgeHandleHints(
  nodes: RFNode[],
  edges: RFEdge[],
): Map<string, EdgeHandleHints> {
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const hints = new Map<string, EdgeHandleHints>();

  for (const edge of edges) {
    const sourceNode = nodesById.get(edge.source);
    const targetNode = nodesById.get(edge.target);
    if (!sourceNode || !targetNode) continue;

    const sourceRect = toNodeRect(sourceNode);
    const targetRect = toNodeRect(targetNode);
    const route = getDependencyRouteForRects(
      sourceRect,
      targetRect,
      readDependencyRouteSlotData(edge.data),
    );

    hints.set(edge.source, {
      ...(hints.get(edge.source) ?? {}),
      source: toDependencyEndpointHint(route.source, sourceRect),
    });
    hints.set(edge.target, {
      ...(hints.get(edge.target) ?? {}),
      target: toDependencyEndpointHint(route.target, targetRect),
    });
  }

  return new Map(
    [...hints].map(([nodeId, hint]) => [
      nodeId,
      resolveEdgeHandleOverlap(hint),
    ]),
  );
}

export function resolveEdgeHandleOverlap(
  hints: EdgeHandleHints,
): EdgeHandleHints {
  const source = hints.source ?? DEFAULT_SOURCE_HANDLE_HINT;
  const target = hints.target ?? DEFAULT_TARGET_HANDLE_HINT;
  if (source.side !== target.side) return hints;
  if (Math.abs(source.offset - target.offset) > HANDLE_OVERLAP_THRESHOLD) {
    return hints;
  }

  const midpoint = Math.round((source.offset + target.offset) / 2);
  return {
    target: { ...target, offset: midpoint - HANDLE_OVERLAP_OFFSET },
    source: { ...source, offset: midpoint + HANDLE_OVERLAP_OFFSET },
  };
}

function toNodeRect(node: RFNode): DependencyNodeRect {
  const width = readNodeNumber(node, "width") ?? DEPENDENCY_NODE_FALLBACK_WIDTH;
  const height =
    readNodeNumber(node, "height") ?? DEPENDENCY_NODE_FALLBACK_HEIGHT;
  return {
    x: node.position.x - width / 2,
    y: node.position.y - height / 2,
    width,
    height,
  };
}

function readNodeNumber(node: RFNode, key: "width" | "height"): number | null {
  const measured = node.measured?.[key];
  if (typeof measured === "number") return measured;
  const value = node[key];
  return typeof value === "number" ? value : null;
}

export function getCanvasNodeIdAtPoint(
  x: number,
  y: number,
  root: ParentNode = document,
): string | null {
  const element =
    root instanceof Document ? root.elementFromPoint(x, y) : document.elementFromPoint(x, y);
  const node = element?.closest("[data-node-id]");
  return node instanceof HTMLElement ? node.dataset.nodeId ?? null : null;
}

export function toNodeDropConnection(
  connectionState: FinalConnectionState,
  targetNodeId: string | null,
): Connection | null {
  if (connectionState.isValid || !connectionState.fromNode || !targetNodeId) {
    return null;
  }
  return {
    source: connectionState.fromNode.id,
    target: targetNodeId,
    sourceHandle: null,
    targetHandle: null,
  };
}

function getConnectEndPoint(event: ConnectEndEvent): XYPosition | null {
  if (event instanceof MouseEvent) {
    return { x: event.clientX, y: event.clientY };
  }
  const touch = event.changedTouches[0];
  return touch ? { x: touch.clientX, y: touch.clientY } : null;
}

function isPointInsideElement(
  event: ReactMouseEvent,
  element: HTMLElement | null,
): boolean {
  if (!element) return false;
  const rect = element.getBoundingClientRect();
  return (
    event.clientX >= rect.left &&
    event.clientX <= rect.right &&
    event.clientY >= rect.top &&
    event.clientY <= rect.bottom
  );
}

function CanvasInner() {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const trashRef = useRef<HTMLDivElement>(null);
  const [isDropTarget, setIsDropTarget] = useState(false);
  const [isNodeDragging, setIsNodeDragging] = useState(false);
  const [isTrashTarget, setIsTrashTarget] = useState(false);
  const [hoveredEdgeId, setHoveredEdgeId] = useState<string | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const { screenToFlowPosition } = useReactFlow();
  const { nodes, edges, onNodesChange, onEdgesChange, onConnect } =
    useWorkflowStore(
      useShallow((s) => ({
        nodes: s.nodes,
        edges: s.edges,
        onNodesChange: s.onNodesChange,
        onEdgesChange: s.onEdgesChange,
        onConnect: s.onConnect,
      })),
    );
  const addSkillNode = useWorkflowStore((s) => s.addSkillNode);
  const deleteNode = useWorkflowStore((s) => s.deleteNode);
  const connectionWarning = useWorkflowStore((s) => s.connectionWarning);
  const clearConnectionWarning = useWorkflowStore(
    (s) => s.clearConnectionWarning,
  );
  const activeRepoPath = useRepositoryStore((s) => {
    if (!s.selectedId) return null;
    return s.repositories.find((r) => r.id === s.selectedId)?.path ?? null;
  });
  const defaultSkills = useSkillStore((s) => s.defaultSkills);
  const renderedEdges = useMemo(() => toRenderedCanvasEdges(edges), [edges]);
  const renderedNodes = useMemo(() => {
    const graph = analyzeWorkflowGraph(
      nodes.map((node) => node.id),
      edges,
    );
    const rootNodeId = graph.valid ? graph.rootNodeId : null;
    const activeEdge =
      renderedEdges.find((edge) => edge.id === hoveredEdgeId) ??
      renderedEdges.find((edge) => edge.selected);
    const edgeHandleHints = toEdgeHandleHints(nodes, renderedEdges);
    return nodes.map((node) => ({
      ...node,
      data: {
        ...node.data,
        isRoot: node.id === rootNodeId,
        edgeRole:
          activeEdge?.source === node.id && activeEdge?.target === node.id
            ? "both"
            : activeEdge?.source === node.id
              ? "source"
              : activeEdge?.target === node.id
                ? "target"
                : null,
        edgeHandleHints: edgeHandleHints.get(node.id) ?? null,
      },
    }));
  }, [edges, hoveredEdgeId, nodes, renderedEdges]);

  useEffect(() => {
    if (!connectionWarning) return;
    const timer = window.setTimeout(() => {
      clearConnectionWarning(connectionWarning.id);
    }, 4000);
    return () => window.clearTimeout(timer);
  }, [clearConnectionWarning, connectionWarning]);

  const onDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (event.dataTransfer.types.includes(SKILL_DRAG_MIME)) {
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
      setIsDropTarget(true);
    }
  }, []);

  const onDragLeave = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (
      wrapperRef.current &&
      !wrapperRef.current.contains(event.relatedTarget as Node | null)
    ) {
      setIsDropTarget(false);
    }
  }, []);

  const onDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      setIsDropTarget(false);
      const raw = event.dataTransfer.getData(SKILL_DRAG_MIME);
      if (!raw) return;
      event.preventDefault();
      let payload: SkillDragPayload;
      try {
        payload = JSON.parse(raw) as SkillDragPayload;
      } catch {
        return;
      }
      const position = toCanvasDropPosition(screenToFlowPosition, event);
      addSkillNode(
        {
          id:
            payload.source === "system" && payload.systemSkillId
              ? payload.systemSkillId
              : `${payload.provider}:${payload.skillFile.replace(/\/SKILL\.md$/, "")}`,
          provider: payload.provider,
          source: payload.source ?? "repository",
          name: payload.name,
          description: payload.description ?? "",
          inputHints: payload.inputHints ?? [],
          defaultInput: payload.defaultInput,
          defaultModel: payload.defaultModel,
          rootDir:
            payload.source === "system" && payload.systemSkillId
              ? `system://${payload.systemSkillId}`
              : payload.skillFile.replace(/\/SKILL\.md$/, ""),
          skillFile: payload.skillFile,
          skillFileAbsPath: payload.skillFileAbsPath,
          ...(payload.source === "system" && payload.systemSkillId
            ? { systemSkillId: payload.systemSkillId }
            : {}),
        },
        position,
      );
    },
    [addSkillNode, screenToFlowPosition],
  );

  const onNodeDragStart = useCallback(() => {
    setMenu(null);
    setIsNodeDragging(true);
    setIsTrashTarget(false);
  }, []);

  const onNodeDrag = useCallback((event: ReactMouseEvent) => {
    setIsTrashTarget(isPointInsideElement(event, trashRef.current));
  }, []);

  const onNodeDragStop = useCallback(
    (event: ReactMouseEvent, node: RFNode) => {
      const shouldDelete = isPointInsideElement(event, trashRef.current);
      setIsNodeDragging(false);
      setIsTrashTarget(false);
      if (shouldDelete) {
        setMenu(null);
        deleteNode(node.id);
      }
    },
    [deleteNode],
  );

  const onNodeContextMenu = useCallback(
    (event: ReactMouseEvent, node: RFNode) => {
      event.preventDefault();
      const skillNode = node as SkillNodeType;
      setMenu({
        x: event.clientX,
        y: event.clientY,
        nodeId: skillNode.id,
        skillFile: skillNode.data.skillRef.skillFile,
        source: skillNode.data.skillRef.source,
        skillFileAbsPath: skillNode.data.skillRef.skillFileAbsPath,
        systemSkillId: skillNode.data.skillRef.systemSkillId,
      });
    },
    [],
  );

  const onConnectEnd = useCallback(
    (event: ConnectEndEvent, connectionState: FinalConnectionState) => {
      if (connectionState.isValid || !connectionState.fromNode) return;
      const point = getConnectEndPoint(event);
      if (!point) return;
      const targetNodeId = getCanvasNodeIdAtPoint(point.x, point.y);
      const connection = toNodeDropConnection(connectionState, targetNodeId);
      if (connection) onConnect(connection);
    },
    [onConnect],
  );

  const menuItems: SkillNodeMenuItem[] = useMemo(() => {
    if (!menu) return [];
    const absolutePath = resolveSkillFilePath(menu, activeRepoPath, defaultSkills);
    return [
      {
        label: "Show in Finder",
        disabled: !absolutePath,
        onSelect: () => {
          if (absolutePath) void revealItemInDir(absolutePath);
        },
      },
      {
        label: "Open SKILL.md",
        disabled: !absolutePath,
        onSelect: () => {
          if (absolutePath) void openPath(absolutePath);
        },
      },
      {
        label: "Remove from workflow",
        onSelect: () => {
          const store = useWorkflowStore.getState();
          store.selectNode(menu.nodeId);
          store.deleteSelected();
        },
      },
    ];
  }, [menu, activeRepoPath, defaultSkills]);

  return (
    <section
      ref={wrapperRef}
      className={`workspace__canvas${isDropTarget ? " is-drop-target" : ""}`}
      data-testid="workflow-canvas"
      data-drop-target={isDropTarget ? "true" : "false"}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <ReactFlow
        nodes={renderedNodes}
        edges={renderedEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        defaultEdgeOptions={CANVAS_DEFAULT_EDGE_OPTIONS}
        nodeOrigin={CANVAS_NODE_ORIGIN}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeContextMenu={onNodeContextMenu}
        onNodeDragStart={onNodeDragStart}
        onNodeDrag={onNodeDrag}
        onNodeDragStop={onNodeDragStop}
        onEdgeMouseEnter={(_, edge) => setHoveredEdgeId(edge.id)}
        onEdgeMouseLeave={() => setHoveredEdgeId(null)}
        onPaneClick={() => setMenu(null)}
        onConnectEnd={onConnectEnd}
        connectionMode={CANVAS_CONNECTION_MODE}
        deleteKeyCode={["Backspace", "Delete"]}
        colorMode="dark"
        fitView
        fitViewOptions={CANVAS_FIT_VIEW_OPTIONS}
        maxZoom={CANVAS_MAX_ZOOM}
      >
        <Background gap={16} />
        <Controls />
      </ReactFlow>
      {connectionWarning ? (
        <div
          className="canvas-warning-toast"
          role="status"
          aria-live="polite"
          data-testid="canvas-connection-warning"
        >
          {connectionWarning.message}
        </div>
      ) : null}
      <div
        ref={trashRef}
        className={`canvas-trash-dropzone${isNodeDragging ? " is-visible" : ""}${isTrashTarget ? " is-over" : ""}`}
        data-testid="canvas-trash-dropzone"
        data-active={isNodeDragging ? "true" : "false"}
        data-over={isTrashTarget ? "true" : "false"}
        aria-label="Drop node to delete"
        aria-hidden={isNodeDragging ? "false" : "true"}
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className="canvas-trash-dropzone__icon"
        >
          <path d="M9 3h6l1 2h4v2H4V5h4l1-2Z" />
          <path d="M6 9h12l-1 12H7L6 9Zm4 2v8h2v-8h-2Zm4 0v8h2v-8h-2Z" />
        </svg>
      </div>
      {menu && (
        <SkillNodeMenu
          x={menu.x}
          y={menu.y}
          items={menuItems}
          onClose={() => setMenu(null)}
        />
      )}
    </section>
  );
}

export function Canvas() {
  return (
    <ReactFlowProvider>
      <CanvasInner />
    </ReactFlowProvider>
  );
}
