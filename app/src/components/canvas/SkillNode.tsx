import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { SkillNode as SkillNodeType } from "../../stores/workflowStore";

export function SkillNode({ id, data, selected }: NodeProps<SkillNodeType>) {
  const provider = data.skillRef.provider;
  return (
    <div
      className={`skill-node skill-node--${provider}${selected ? " is-selected" : ""}`}
      data-testid="workflow-node"
      data-node-id={id}
      data-skill-provider={provider}
    >
      <Handle type="target" position={Position.Top} />
      <div className="skill-node__row">
        <span className="skill-node__name">{data.label}</span>
        <span className={`skill-list__chip skill-list__chip--${provider}`}>
          {provider}
        </span>
      </div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

export const nodeTypes = { skill: SkillNode };
