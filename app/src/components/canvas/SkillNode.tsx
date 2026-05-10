import { Handle, Position, type NodeProps } from "@xyflow/react";
import { useNodeRunState } from "../../runner/runStore";
import { useWorkflowStore } from "../../stores/workflowStore";
import type { SkillNode as SkillNodeType } from "../../stores/workflowStore";

export function SkillNode({ id, data, selected }: NodeProps<SkillNodeType>) {
  const provider = data.skillRef.provider;
  const runState = useNodeRunState(id);
  const inputSummary = summarizeInput(data.input);
  const handleEditInput = () => {
    useWorkflowStore.getState().selectNode(id);
  };

  return (
    <div
      className={`skill-node skill-node--${provider} skill-node--${runState} skill-node--input-${inputSummary.state}${selected ? " is-selected" : ""}`}
      data-testid="workflow-node"
      data-node-id={id}
      data-skill-provider={provider}
      data-run-state={runState}
      data-input-state={inputSummary.state}
    >
      <Handle type="target" position={Position.Top} />
      <div className="skill-node__row">
        <span className="skill-node__name">{data.label}</span>
        <span className={`skill-list__chip skill-list__chip--${provider}`}>
          {provider}
        </span>
      </div>
      <div className="skill-node__input" data-testid="skill-node-input-summary">
        <span className="skill-node__input-state">{inputSummary.label}</span>
        <span className="skill-node__input-summary" title={inputSummary.summary}>
          {inputSummary.summary}
        </span>
        <button
          type="button"
          className="skill-node__input-affordance nodrag nopan"
          data-testid="skill-node-input-edit"
          aria-label={`Edit input for ${data.label}`}
          onClick={handleEditInput}
        >
          Edit
        </button>
      </div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

export const nodeTypes = { skill: SkillNode };

type InputSummary = {
  state: "none" | "present" | "invalid";
  label: string;
  summary: string;
};

function summarizeInput(input: unknown): InputSummary {
  if (input === undefined) {
    return { state: "none", label: "No input", summary: "No input configured" };
  }
  if (!isRecord(input)) {
    return {
      state: "invalid",
      label: "Invalid input",
      summary: "Input data cannot be previewed",
    };
  }

  const entries = Object.entries(input);
  if (entries.length === 0) {
    return { state: "none", label: "No input", summary: "No input configured" };
  }

  return {
    state: "present",
    label: "Input set",
    summary: entries.map(([key, value]) => `${key}: ${summarizeValue(value)}`).join(", "),
  };
}

function summarizeValue(value: unknown): string {
  if (typeof value === "string") return value || "\"\"";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value === null) return "null";
  try {
    return JSON.stringify(value);
  } catch {
    return "[unserializable]";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
