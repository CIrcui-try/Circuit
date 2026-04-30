import type { Edge } from "@xyflow/react";
import type { SkillNode } from "../stores/workflowStore";
import {
  WORKFLOW_VERSION,
  type Workflow,
  type WorkflowEdge,
  type WorkflowSkillNode,
} from "./schema";

export type SerializeMeta = {
  id: string;
  repositoryId: string;
  name: string;
  createdAt: string;
};

export type DeserializedWorkflow = {
  nodes: SkillNode[];
  edges: Edge[];
  meta: {
    id: string;
    name: string;
    repositoryId: string;
    createdAt: string;
    updatedAt: string;
  };
};

export function toWorkflow(
  state: { nodes: SkillNode[]; edges: Edge[] },
  meta: SerializeMeta,
  now: () => string = () => new Date().toISOString(),
): Workflow {
  const nodes: WorkflowSkillNode[] = state.nodes.map((n) => ({
    id: n.id,
    type: "skill",
    skillRef: {
      provider: n.data.skillRef.provider,
      skillFile: n.data.skillRef.skillFile,
    },
    label: n.data.label,
    position: {
      x: Math.round(n.position.x),
      y: Math.round(n.position.y),
    },
  }));

  const edges: WorkflowEdge[] = state.edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    kind: "dependency",
  }));

  return {
    version: WORKFLOW_VERSION,
    id: meta.id,
    repositoryId: meta.repositoryId,
    name: meta.name,
    nodes,
    edges,
    createdAt: meta.createdAt,
    updatedAt: now(),
  };
}

export function fromWorkflow(wf: Workflow): DeserializedWorkflow {
  if (wf.version !== WORKFLOW_VERSION) {
    throw new Error(
      `Unsupported workflow version: ${String(wf.version)} (expected ${WORKFLOW_VERSION})`,
    );
  }
  if (!wf.id || !wf.repositoryId) {
    throw new Error("Workflow is missing required id or repositoryId");
  }

  const nodes: SkillNode[] = wf.nodes.map((n) => {
    if (n.type !== "skill") {
      throw new Error(`Unsupported node type: ${String(n.type)}`);
    }
    if (!n.skillRef || !n.skillRef.provider || !n.skillRef.skillFile) {
      throw new Error(`Node ${n.id} is missing skillRef`);
    }
    return {
      id: n.id,
      type: "skill",
      position: { x: n.position.x, y: n.position.y },
      data: {
        label: n.label,
        skillRef: {
          provider: n.skillRef.provider,
          skillFile: n.skillRef.skillFile,
        },
      },
    };
  });

  const edges: Edge[] = wf.edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
  }));

  return {
    nodes,
    edges,
    meta: {
      id: wf.id,
      name: wf.name,
      repositoryId: wf.repositoryId,
      createdAt: wf.createdAt,
      updatedAt: wf.updatedAt,
    },
  };
}
