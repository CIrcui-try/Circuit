import { Handle, Position, type NodeProps } from "@xyflow/react";
import {
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type SyntheticEvent,
} from "react";
import { createPortal } from "react-dom";
import { HoverTooltip } from "../HoverTooltip";
import { useNodeRunState, useRunStore } from "../../runner/runStore";
import { defaultSkillFileForLegacySystemId } from "../../skills/defaultSkillFiles";
import { useSkillStore } from "../../stores/skillStore";
import { useWorkflowStore } from "../../stores/workflowStore";
import type { SkillNode as SkillNodeType } from "../../stores/workflowStore";
import type { SkillInputHint } from "../../host/bridge";

const EMPTY_INPUT_HINTS: SkillInputHint[] = [];

export function SkillNode({ id, data, selected }: NodeProps<SkillNodeType>) {
  const provider = data.skillRef.provider;
  const storedDescription =
    typeof data.description === "string" ? data.description.trim() : "";
  const scannedDescription = useSkillStore((state) =>
    findSkillDescription(
      state.byRepo,
      state.defaultSkills,
      provider,
      data.skillRef.skillFile,
      data.skillRef.source,
      data.skillRef.systemSkillId,
    ),
  );
  const scannedInputHints = useSkillStore((state) =>
    findSkillInputHints(
      state.byRepo,
      state.defaultSkills,
      provider,
      data.skillRef.skillFile,
      data.skillRef.source,
      data.skillRef.systemSkillId,
    ),
  );
  const description = storedDescription || scannedDescription;
  const inputHints = readInputHints(data.inputHints) ?? scannedInputHints;
  const argumentsHint = inputHints.find((hint) => hint.key === "arguments");
  const runState = useNodeRunState(id);
  const activeCycleIteration = useRunStore((state) =>
    state.runMode === "cycle" && state.activeNodeId === id
      ? state.iteration
      : null,
  );
  const inputSummary = summarizeInput(data.input);
  const stackInputSummary = shouldStackInputSummary(inputSummary.items);
  const editButtonRef = useRef<HTMLButtonElement>(null);
  const [isEditingInput, setIsEditingInput] = useState(false);
  const [popoverPosition, setPopoverPosition] = useState({ top: 0, left: 0 });
  const [draftArguments, setDraftArguments] = useState("");
  const [draftPrompt, setDraftPrompt] = useState("");

  const handleEditInput = () => {
    useWorkflowStore.getState().selectNode(id);
    const current = useWorkflowStore.getState().nodes.find((n) => n.id === id)
      ?.data.input ?? data.input;
    setDraftArguments(readArguments(current));
    setDraftPrompt(readPrompt(current));
    setIsEditingInput((open) => !open);
  };

  useLayoutEffect(() => {
    if (!isEditingInput) return;
    let frame = 0;
    const updatePosition = () => {
      const rect = editButtonRef.current?.getBoundingClientRect();
      if (rect) {
        const next = { top: rect.bottom + 8, left: rect.left };
        setPopoverPosition((current) =>
          current.top === next.top && current.left === next.left
            ? current
            : next,
        );
      }
      frame = requestAnimationFrame(updatePosition);
    };
    updatePosition();
    return () => cancelAnimationFrame(frame);
  }, [isEditingInput]);

  const handleArgumentsChange = (value: string) => {
    setDraftArguments(value);
    updateInputField(id, "arguments", value);
  };

  const handlePromptChange = (value: string) => {
    setDraftPrompt(value);
    updateInputField(id, "prompt", value);
  };

  const dismissInputEditor = () => {
    setIsEditingInput(false);
  };

  const handleInputKeyDown = (
    event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => {
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    dismissInputEditor();
  };

  const stopCanvasInteraction = (event: SyntheticEvent) => {
    event.stopPropagation();
  };

  return (
    <div
      className={`skill-node skill-node--${provider} skill-node--${runState} skill-node--input-${inputSummary.state}${selected ? " is-selected" : ""}`}
      data-testid="workflow-node"
      data-node-id={id}
      data-skill-provider={provider}
      data-run-state={runState}
      data-run-iteration={activeCycleIteration ?? undefined}
      data-input-state={inputSummary.state}
    >
      <Handle type="target" position={Position.Top} />
      <div className="skill-node__row">
        <span className="skill-node__name">{data.label}</span>
        <span className={`skill-list__chip skill-list__chip--${provider}`}>
          {provider}
        </span>
        {activeCycleIteration != null ? (
          <span
            className="skill-node__iteration"
            data-testid="skill-node-iteration"
          >
            Loop {activeCycleIteration}
          </span>
        ) : null}
      </div>
      {description ? (
        <HoverTooltip
          className="skill-node__description-wrap"
          content={description}
          testId="skill-node-description-tooltip"
        >
          <div
            className="skill-node__description"
            data-testid="skill-node-description"
          >
            {description}
          </div>
        </HoverTooltip>
      ) : null}
      <div className="skill-node__input" data-testid="skill-node-input-summary">
        {inputSummary.state === "present" ? (
          <span
            className={`skill-node__input-summary${stackInputSummary ? " skill-node__input-summary--stacked" : ""}`}
            title={inputSummary.summary}
          >
            {inputSummary.items.map((item, index) => (
              <span
                key={item.key}
                className={`skill-node__input-token${item.key === "arguments" ? " skill-node__input-token--arguments" : ""}`}
              >
                {index > 0 && !stackInputSummary ? (
                  <span className="skill-node__input-separator">, </span>
                ) : null}
                <span className="skill-node__input-key">{item.key}</span>
                <span className="skill-node__input-separator">: </span>
                <span>{item.value}</span>
              </span>
            ))}
          </span>
        ) : (
          <span className="skill-node__input-state">{inputSummary.summary}</span>
        )}
        <button
          ref={editButtonRef}
          type="button"
          className="skill-node__input-affordance nodrag nopan"
          data-testid="skill-node-input-edit"
          aria-label={`Edit input for ${data.label}`}
          aria-expanded={isEditingInput}
          onClick={handleEditInput}
          onPointerDown={stopCanvasInteraction}
          onMouseDown={stopCanvasInteraction}
        >
          Edit
        </button>
      </div>
      {isEditingInput
        ? createPortal(
            <div
              className="skill-node-input-popover nodrag nopan"
              data-testid="skill-node-input-popover"
              role="dialog"
              aria-label={`Input for ${data.label}`}
              style={popoverPosition}
              onClick={stopCanvasInteraction}
              onPointerDown={stopCanvasInteraction}
              onMouseDown={stopCanvasInteraction}
            >
              <div className="skill-node-input-popover__header">
                <span className="skill-node-input-popover__title">Input</span>
                <button
                  type="button"
                  className="skill-node-input-popover__close"
                  aria-label="Close input editor"
                  onClick={dismissInputEditor}
                >
                  ×
                </button>
              </div>
              <div className="skill-node-input-popover__fields">
                <label className="skill-node-input-popover__field">
                  <span>{argumentsHint?.label ?? "Arguments"}</span>
                  <textarea
                    className="skill-node-input-popover__textarea"
                    data-testid="skill-node-input-arguments"
                    value={draftArguments}
                    placeholder={argumentsHint?.placeholder ?? "Arguments"}
                    onChange={(e) => handleArgumentsChange(e.target.value)}
                    onKeyDown={handleInputKeyDown}
                  />
                </label>
                <label className="skill-node-input-popover__field">
                  <span>Prompt</span>
                  <textarea
                    className="skill-node-input-popover__textarea"
                    data-testid="skill-node-input-prompt"
                    value={draftPrompt}
                    placeholder="Prompt"
                    onChange={(e) => handlePromptChange(e.target.value)}
                    onKeyDown={handleInputKeyDown}
                  />
                </label>
              </div>
              <div className="skill-node-input-popover__footer">
                <button
                  type="button"
                  className="skill-node-input-popover__done"
                  data-testid="skill-node-input-done"
                  onClick={dismissInputEditor}
                >
                  Done
                </button>
              </div>
            </div>,
            document.body,
          )
        : null}
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

function updateInputField(
  nodeId: string,
  key: "arguments" | "prompt",
  value: string,
) {
  const store = useWorkflowStore.getState();
  const current = store.nodes.find((n) => n.id === nodeId)?.data.input;
  const next = isRecord(current) ? { ...current } : {};
  if (value.trim().length > 0) {
    next[key] = value;
  } else {
    delete next[key];
  }
  store.setNodeInput(nodeId, Object.keys(next).length > 0 ? next : null);
}

function readPrompt(input: unknown): string {
  if (!isRecord(input)) return "";
  return typeof input.prompt === "string" ? input.prompt : "";
}

function findSkillDescription(
  byRepo: ReturnType<typeof useSkillStore.getState>["byRepo"],
  defaultSkills: ReturnType<typeof useSkillStore.getState>["defaultSkills"],
  provider: SkillNodeType["data"]["skillRef"]["provider"],
  skillFile: string,
  source: SkillNodeType["data"]["skillRef"]["source"],
  systemSkillId?: string,
): string {
  const resolvedSkillFile =
    source === "system"
      ? defaultSkillFileForLegacySystemId(systemSkillId)
      : skillFile;
  if (!resolvedSkillFile) return "";

  const collections =
    source === "default" || source === "system"
      ? [defaultSkills]
      : Object.values(byRepo);
  for (const skills of collections) {
    const match = skills.find(
      (skill) =>
        skill.provider === provider && skill.skillFile === resolvedSkillFile,
    );
    if (match?.description.trim()) return match.description.trim();
  }
  return "";
}

function findSkillInputHints(
  byRepo: ReturnType<typeof useSkillStore.getState>["byRepo"],
  defaultSkills: ReturnType<typeof useSkillStore.getState>["defaultSkills"],
  provider: SkillNodeType["data"]["skillRef"]["provider"],
  skillFile: string,
  source: SkillNodeType["data"]["skillRef"]["source"],
  systemSkillId?: string,
): SkillInputHint[] {
  const resolvedSkillFile =
    source === "system"
      ? defaultSkillFileForLegacySystemId(systemSkillId)
      : skillFile;
  if (!resolvedSkillFile) return EMPTY_INPUT_HINTS;

  const collections =
    source === "default" || source === "system"
      ? [defaultSkills]
      : Object.values(byRepo);
  for (const skills of collections) {
    const match = skills.find(
      (skill) =>
        skill.provider === provider && skill.skillFile === resolvedSkillFile,
    );
    if (match?.inputHints?.length) return match.inputHints;
  }
  return EMPTY_INPUT_HINTS;
}

function readInputHints(value: unknown): SkillInputHint[] | null {
  if (!Array.isArray(value)) return null;
  return value.filter(isSkillInputHint);
}

function isSkillInputHint(value: unknown): value is SkillInputHint {
  if (!isRecord(value)) return false;
  return (
    value.kind === "command" &&
    value.key === "arguments" &&
    typeof value.label === "string" &&
    typeof value.placeholder === "string"
  );
}

export const nodeTypes = { skill: SkillNode };

type InputSummary = {
  state: "none" | "present" | "invalid";
  summary: string;
  items: InputSummaryItem[];
};

type InputSummaryItem = {
  key: string;
  value: string;
};

function shouldStackInputSummary(items: InputSummaryItem[]): boolean {
  const keys = new Set(items.map((item) => item.key));
  return keys.has("arguments") && keys.has("prompt");
}

function summarizeInput(input: unknown): InputSummary {
  if (input === undefined) {
    return { state: "none", summary: "No input configured", items: [] };
  }
  if (!isRecord(input)) {
    return {
      state: "invalid",
      summary: "Input data cannot be previewed",
      items: [],
    };
  }

  const entries = Object.entries(input);
  if (entries.length === 0) {
    return { state: "none", summary: "No input configured", items: [] };
  }
  const items = entries.map(([key, value]) => ({ key, value: summarizeValue(value) }));

  return {
    state: "present",
    summary: items.map((item) => `${item.key}: ${item.value}`).join(", "),
    items,
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

function readArguments(input: unknown): string {
  if (!isRecord(input)) return "";
  return typeof input.arguments === "string" ? input.arguments : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
