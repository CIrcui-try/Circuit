import {
  WORKFLOW_SKILL_PROVIDERS,
  WORKFLOW_VERSION,
  type WorkflowSkillProvider,
} from "./schema";

export type ValidationResult = { ok: true } | { ok: false; errors: string[] };

const PLACEHOLDER_RE = /\$\{steps\.([^.}]+)\.output\}/g;
const PLACEHOLDER_SHAPE_RE = /\$\{steps\.[^}]*\}/g;

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isProvider(v: unknown): v is WorkflowSkillProvider {
  return typeof v === "string" && (WORKFLOW_SKILL_PROVIDERS as readonly string[]).includes(v);
}

function collectPlaceholderRefs(input: Record<string, unknown>, errors: string[], where: string) {
  const refs: string[] = [];
  for (const [key, raw] of Object.entries(input)) {
    if (typeof raw !== "string") continue;
    const allMatches = raw.match(PLACEHOLDER_SHAPE_RE) ?? [];
    for (const m of allMatches) {
      if (!/^\$\{steps\.[^.}]+\.output\}$/.test(m)) {
        errors.push(`${where}.input.${key} contains malformed placeholder: ${m}`);
      }
    }
    let match: RegExpExecArray | null;
    PLACEHOLDER_RE.lastIndex = 0;
    while ((match = PLACEHOLDER_RE.exec(raw)) !== null) {
      refs.push(match[1]);
    }
  }
  return refs;
}

export function validateWorkflow(value: unknown): ValidationResult {
  const errors: string[] = [];

  if (!isObject(value)) {
    return { ok: false, errors: ["workflow must be an object"] };
  }

  if (value.version !== WORKFLOW_VERSION) {
    errors.push(`workflow.version must be "${WORKFLOW_VERSION}" (got ${JSON.stringify(value.version)})`);
  }
  if (typeof value.id !== "string" || value.id.length === 0) {
    errors.push("workflow.id is required (non-empty string)");
  }
  if (typeof value.repositoryId !== "string" || value.repositoryId.length === 0) {
    errors.push("workflow.repositoryId is required (non-empty string)");
  }
  if (!Array.isArray(value.nodes)) {
    errors.push("workflow.nodes must be an array");
  }
  if (!Array.isArray(value.edges)) {
    errors.push("workflow.edges must be an array");
  }

  const nodeIds = new Set<string>();
  const placeholderRefs: { nodeId: string; sourceId: string }[] = [];

  if (Array.isArray(value.nodes)) {
    value.nodes.forEach((node, idx) => {
      const where = `nodes[${idx}]`;
      if (!isObject(node)) {
        errors.push(`${where} must be an object`);
        return;
      }
      if (typeof node.id !== "string" || node.id.length === 0) {
        errors.push(`${where}.id is required (non-empty string)`);
      } else {
        if (nodeIds.has(node.id)) {
          errors.push(`${where}.id "${node.id}" is duplicated`);
        }
        nodeIds.add(node.id);
      }
      if (node.type !== "skill") {
        errors.push(`${where}.type must be "skill" (got ${JSON.stringify(node.type)})`);
      }
      if (!isObject(node.skillRef)) {
        errors.push(`${where}.skillRef is required`);
      } else {
        if (!isProvider(node.skillRef.provider)) {
          errors.push(
            `${where}.skillRef.provider must be one of ${WORKFLOW_SKILL_PROVIDERS.join(", ")} (got ${JSON.stringify(node.skillRef.provider)})`,
          );
        }
        if (typeof node.skillRef.skillFile !== "string" || node.skillRef.skillFile.length === 0) {
          errors.push(`${where}.skillRef.skillFile is required (non-empty string)`);
        }
      }
      if (node.input !== undefined) {
        if (!isObject(node.input)) {
          errors.push(`${where}.input must be an object when present`);
        } else if (typeof node.id === "string") {
          const refs = collectPlaceholderRefs(node.input, errors, where);
          for (const sourceId of refs) {
            placeholderRefs.push({ nodeId: node.id, sourceId });
          }
        }
      }
    });
  }

  if (Array.isArray(value.edges)) {
    const edgeIds = new Set<string>();
    value.edges.forEach((edge, idx) => {
      const where = `edges[${idx}]`;
      if (!isObject(edge)) {
        errors.push(`${where} must be an object`);
        return;
      }
      if (typeof edge.id !== "string" || edge.id.length === 0) {
        errors.push(`${where}.id is required (non-empty string)`);
      } else {
        if (edgeIds.has(edge.id)) {
          errors.push(`${where}.id "${edge.id}" is duplicated`);
        }
        edgeIds.add(edge.id);
      }
      if (typeof edge.source !== "string" || !nodeIds.has(edge.source)) {
        errors.push(`${where}.source must reference an existing node id`);
      }
      if (typeof edge.target !== "string" || !nodeIds.has(edge.target)) {
        errors.push(`${where}.target must reference an existing node id`);
      }
      if (edge.kind !== "dependency") {
        errors.push(`${where}.kind must be "dependency"`);
      }
    });
  }

  for (const { nodeId, sourceId } of placeholderRefs) {
    if (!nodeIds.has(sourceId)) {
      errors.push(
        `nodes[id=${nodeId}].input references unknown source node "${sourceId}" via \${steps.${sourceId}.output}`,
      );
    }
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}
