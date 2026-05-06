import { Handle, Position, type NodeProps } from "@xyflow/react";
import { openPath, revealItemInDir } from "@tauri-apps/plugin-opener";
import { useState } from "react";
import { useNodeRunState } from "../../runner/runStore";
import { useRepositoryStore } from "../../stores/repositoryStore";
import { useWorkflowStore } from "../../stores/workflowStore";
import type { SkillNode as SkillNodeType } from "../../stores/workflowStore";
import { SkillNodeMenu, type SkillNodeMenuItem } from "./SkillNodeMenu";

type MenuPos = { x: number; y: number };

function joinPath(base: string, rel: string): string {
  const trimmedBase = base.replace(/\/+$/, "");
  const trimmedRel = rel.replace(/^\/+/, "");
  return `${trimmedBase}/${trimmedRel}`;
}

export function SkillNode({ id, data, selected }: NodeProps<SkillNodeType>) {
  const provider = data.skillRef.provider;
  const runState = useNodeRunState(id);
  const [menuPos, setMenuPos] = useState<MenuPos | null>(null);

  const activeRepoPath = useRepositoryStore((s) => {
    if (!s.selectedId) return null;
    return s.repositories.find((r) => r.id === s.selectedId)?.path ?? null;
  });

  const skillFile = data.skillRef.skillFile;
  const absolutePath =
    activeRepoPath && skillFile ? joinPath(activeRepoPath, skillFile) : null;

  const items: SkillNodeMenuItem[] = [
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
        store.selectNode(id);
        store.deleteSelected();
      },
    },
  ];

  return (
    <>
      <div
        className={`skill-node skill-node--${provider} skill-node--${runState}${selected ? " is-selected" : ""}`}
        data-testid="workflow-node"
        data-node-id={id}
        data-skill-provider={provider}
        data-run-state={runState}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setMenuPos({ x: e.clientX, y: e.clientY });
        }}
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
      {menuPos && (
        <SkillNodeMenu
          x={menuPos.x}
          y={menuPos.y}
          items={items}
          onClose={() => setMenuPos(null)}
        />
      )}
    </>
  );
}

export const nodeTypes = { skill: SkillNode };
