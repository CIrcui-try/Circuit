import {
  Background,
  Controls,
  MarkerType,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge as RFEdge,
  type Node as RFNode,
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

export const SKILL_DRAG_MIME = "application/x-circuit-skill";
export const CANVAS_FIT_VIEW_OPTIONS = { maxZoom: 1, padding: 0.25 };
export const CANVAS_EDGE_MARKER: NonNullable<RFEdge["markerEnd"]> = {
  type: MarkerType.ArrowClosed,
};

type SkillDragPayload = {
  provider: "claude" | "codex";
  source?: "repository" | "default" | "system";
  skillFile: string;
  skillFileAbsPath?: string;
  systemSkillId?: string;
  name: string;
  description?: string;
  inputHints?: SkillInputHint[];
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
  const renderedEdges = useMemo(
    () =>
      edges.map((edge) => ({
        ...edge,
        markerEnd: edge.markerEnd ?? CANVAS_EDGE_MARKER,
      })),
    [edges],
  );

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
      const position = screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });
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
        nodes={nodes}
        edges={renderedEdges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeContextMenu={onNodeContextMenu}
        onNodeDragStart={onNodeDragStart}
        onNodeDrag={onNodeDrag}
        onNodeDragStop={onNodeDragStop}
        onPaneClick={() => setMenu(null)}
        deleteKeyCode={["Backspace", "Delete"]}
        colorMode="dark"
        fitView
        fitViewOptions={CANVAS_FIT_VIEW_OPTIONS}
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
