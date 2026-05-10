import {
  Background,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Node as RFNode,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { openPath, revealItemInDir } from "@tauri-apps/plugin-opener";
import {
  useCallback,
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
import {
  useWorkflowStore,
  type SkillNode as SkillNodeType,
} from "../../stores/workflowStore";

export const SKILL_DRAG_MIME = "application/x-circuit-skill";
export const CANVAS_FIT_VIEW_OPTIONS = { maxZoom: 1, padding: 0.25 };

type SkillDragPayload = {
  provider: "claude" | "codex";
  skillFile: string;
  name: string;
};

type MenuState = {
  x: number;
  y: number;
  nodeId: string;
  skillFile: string;
};

function joinPath(base: string, rel: string): string {
  return `${base.replace(/\/+$/, "")}/${rel.replace(/^\/+/, "")}`;
}

function CanvasInner() {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [isDropTarget, setIsDropTarget] = useState(false);
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
  const activeRepoPath = useRepositoryStore((s) => {
    if (!s.selectedId) return null;
    return s.repositories.find((r) => r.id === s.selectedId)?.path ?? null;
  });

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
          id: `${payload.provider}:${payload.skillFile.replace(/\/SKILL\.md$/, "")}`,
          provider: payload.provider,
          name: payload.name,
          description: "",
          rootDir: payload.skillFile.replace(/\/SKILL\.md$/, ""),
          skillFile: payload.skillFile,
        },
        position,
      );
    },
    [addSkillNode, screenToFlowPosition],
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
      });
    },
    [],
  );

  const menuItems: SkillNodeMenuItem[] = useMemo(() => {
    if (!menu) return [];
    const absolutePath =
      activeRepoPath && menu.skillFile
        ? joinPath(activeRepoPath, menu.skillFile)
        : null;
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
  }, [menu, activeRepoPath]);

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
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeContextMenu={onNodeContextMenu}
        onPaneClick={() => setMenu(null)}
        deleteKeyCode={["Backspace", "Delete"]}
        colorMode="dark"
        fitView
        fitViewOptions={CANVAS_FIT_VIEW_OPTIONS}
      >
        <Background gap={16} />
        <Controls />
      </ReactFlow>
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
