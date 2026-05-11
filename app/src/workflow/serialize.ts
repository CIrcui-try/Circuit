import type { Edge } from "@xyflow/react";
import type { SkillNode } from "../stores/workflowStore";
import {
  WORKFLOW_VERSION,
  type Workflow,
  type WorkflowEdge,
  type WorkflowSkillRef,
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
    skillRef: toWorkflowSkillRef(n.data.skillRef),
    label: n.data.label,
    ...(typeof n.data.description === "string" && n.data.description.length > 0
      ? { description: n.data.description }
      : {}),
    position: {
      x: Math.round(n.position.x),
      y: Math.round(n.position.y),
    },
    ...("input" in n.data && isRecord(n.data.input)
      ? { input: n.data.input }
      : {}),
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
    if (!n.skillRef || !n.skillRef.provider) {
      throw new Error(`Node ${n.id} is missing skillRef`);
    }
    if (n.skillRef.provider !== "claude" && n.skillRef.provider !== "codex") {
      throw new Error(
        `Node ${n.id} uses provider "${n.skillRef.provider}" which is reserved for future adapters and not supported by this UI`,
      );
    }
    return {
      id: n.id,
      type: "skill",
      position: { x: n.position.x, y: n.position.y },
      data: {
        label: n.label,
        ...(n.description ? { description: n.description } : {}),
        skillRef: fromWorkflowSkillRef(n.id, n.skillRef),
        ...(n.input ? { input: n.input } : {}),
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function toWorkflowSkillRef(ref: SkillNode["data"]["skillRef"]): WorkflowSkillRef {
  if (ref.source === "system") {
    if (!ref.systemSkillId) {
      throw new Error("System skillRef is missing systemSkillId");
    }
    return {
      source: "system",
      provider: ref.provider,
      systemSkillId: ref.systemSkillId,
    };
  }

  if (ref.source === "default") {
    return {
      source: "default",
      provider: ref.provider,
      skillFile: ref.skillFile,
    };
  }

  return {
    source: "repository",
    provider: ref.provider,
    skillFile: ref.skillFile,
  };
}

function fromWorkflowSkillRef(
  nodeId: string,
  ref: WorkflowSkillRef,
): SkillNode["data"]["skillRef"] {
  const source = ref.source ?? "repository";
  if (source === "system") {
    if (!ref.systemSkillId) {
      throw new Error(`Node ${nodeId} is missing systemSkillId`);
    }
    const provider = toUiProvider(ref.provider);
    return {
      source: "system",
      provider,
      skillFile: "",
      systemSkillId: ref.systemSkillId,
    };
  }

  if (!ref.skillFile) {
    throw new Error(`Node ${nodeId} is missing skillRef.skillFile`);
  }
  return {
    source,
    provider: toUiProvider(ref.provider),
    skillFile: ref.skillFile,
  };
}

function toUiProvider(
  provider: WorkflowSkillRef["provider"],
): SkillNode["data"]["skillRef"]["provider"] {
  if (provider !== "claude" && provider !== "codex") {
    throw new Error(
      `Provider "${provider}" is reserved for future adapters and not supported by this UI`,
    );
  }
  return provider;
}
