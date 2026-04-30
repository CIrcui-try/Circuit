import {
  Background,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useCallback, useRef, type DragEvent } from "react";
import { useShallow } from "zustand/react/shallow";
import { nodeTypes } from "../canvas/SkillNode";
import { useWorkflowStore } from "../../stores/workflowStore";

export const SKILL_DRAG_MIME = "application/x-circuit-skill";

type SkillDragPayload = {
  provider: "claude" | "codex";
  skillFile: string;
  name: string;
};

function CanvasInner() {
  const wrapperRef = useRef<HTMLDivElement>(null);
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

  const onDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (event.dataTransfer.types.includes(SKILL_DRAG_MIME)) {
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
    }
  }, []);

  const onDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
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

  return (
    <section
      ref={wrapperRef}
      className="workspace__canvas"
      data-testid="workflow-canvas"
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        deleteKeyCode={["Backspace", "Delete"]}
        colorMode="dark"
        fitView
      >
        <Background gap={16} />
        <Controls />
      </ReactFlow>
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
