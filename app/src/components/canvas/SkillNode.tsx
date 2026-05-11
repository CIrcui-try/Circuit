import { Handle, Position, type NodeProps } from "@xyflow/react";
import {
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type SyntheticEvent,
} from "react";
import { createPortal } from "react-dom";
import { useNodeRunState } from "../../runner/runStore";
import { useWorkflowStore } from "../../stores/workflowStore";
import type { SkillNode as SkillNodeType } from "../../stores/workflowStore";

export function SkillNode({ id, data, selected }: NodeProps<SkillNodeType>) {
  const provider = data.skillRef.provider;
  const description =
    typeof data.description === "string" ? data.description.trim() : "";
  const runState = useNodeRunState(id);
  const inputSummary = summarizeInput(data.input);
  const inputMode = getInputMode(data.label, data.skillRef.skillFile);
  const editButtonRef = useRef<HTMLButtonElement>(null);
  const [isEditingInput, setIsEditingInput] = useState(false);
  const [popoverPosition, setPopoverPosition] = useState({ top: 0, left: 0 });
  const [draftArguments, setDraftArguments] = useState("");
  const [draftPrompt, setDraftPrompt] = useState("");
  const [draftIssueId, setDraftIssueId] = useState("");
  const [draftForce, setDraftForce] = useState(false);

  const handleEditInput = () => {
    useWorkflowStore.getState().selectNode(id);
    const current = useWorkflowStore.getState().nodes.find((n) => n.id === id)
      ?.data.input ?? data.input;
    setDraftArguments(readArguments(current));
    setDraftPrompt(readPrompt(current));
    const boardingInput = readBoardingArguments(current);
    setDraftIssueId(boardingInput.issueId);
    setDraftForce(boardingInput.force);
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

  const handleBoardingChange = (issueId: string, force: boolean) => {
    setDraftIssueId(issueId);
    setDraftForce(force);
    updateInputField(id, "arguments", formatBoardingArguments(issueId, force));
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
      data-input-state={inputSummary.state}
    >
      <Handle type="target" position={Position.Top} />
      <div className="skill-node__row">
        <span className="skill-node__name">{data.label}</span>
        <span className={`skill-list__chip skill-list__chip--${provider}`}>
          {provider}
        </span>
      </div>
      {description ? (
        <div className="skill-node__description" title={description}>
          {description}
        </div>
      ) : null}
      <div className="skill-node__input" data-testid="skill-node-input-summary">
        {inputSummary.state === "present" ? (
          <span
            className="skill-node__input-summary"
            title={inputSummary.summary}
          >
            {inputSummary.items.map((item, index) => (
              <span key={item.key} className="skill-node__input-token">
                {index > 0 ? <span className="skill-node__input-separator">, </span> : null}
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
              {inputMode === "boarding" ? (
                <BoardingInputFields
                  issueId={draftIssueId}
                  force={draftForce}
                  onChange={handleBoardingChange}
                  onKeyDown={handleInputKeyDown}
                />
              ) : inputMode === "arguments" ? (
                <label className="skill-node-input-popover__field">
                  <span>Arguments</span>
                  <textarea
                    className="skill-node-input-popover__textarea"
                    data-testid="skill-node-input-arguments"
                    value={draftArguments}
                    placeholder="<ISSUE-ID> [--force]"
                    onChange={(e) => handleArgumentsChange(e.target.value)}
                    onKeyDown={handleInputKeyDown}
                  />
                </label>
              ) : (
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
              )}
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

function BoardingInputFields({
  issueId,
  force,
  onChange,
  onKeyDown,
}: {
  issueId: string;
  force: boolean;
  onChange: (issueId: string, force: boolean) => void;
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
}) {
  return (
    <>
      <label className="skill-node-input-popover__field">
        <span>Issue ID</span>
        <input
          className="skill-node-input-popover__input"
          data-testid="skill-node-input-issue"
          value={issueId}
          placeholder="CIR-15"
          onChange={(e) => onChange(e.target.value, force)}
          onKeyDown={onKeyDown}
        />
      </label>
      <label className="skill-node-input-popover__checkbox">
        <input
          data-testid="skill-node-input-force"
          type="checkbox"
          checked={force}
          onChange={(e) => onChange(issueId, e.target.checked)}
        />
        <span>--force</span>
      </label>
    </>
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

const COMMAND_STYLE_SKILLS = new Set([
  "autoland",
  "boarding",
  "cnp",
  "door-closing",
  "landing",
  "rejoin",
  "release",
  "review-and-fix",
  "takeoff",
  "taxiing",
]);

type InputMode = "arguments" | "boarding" | "prompt";

function getInputMode(label: string, skillFile: string): InputMode {
  const skillName = readSkillName(label, skillFile);
  if (skillName === "boarding") return "boarding";
  return COMMAND_STYLE_SKILLS.has(skillName) ? "arguments" : "prompt";
}

function readSkillName(label: string, skillFile: string): string {
  const match = skillFile.match(/\/([^/]+)\/SKILL\.md$/);
  return (match?.[1] ?? label).trim().toLowerCase();
}

function formatBoardingArguments(issueId: string, force: boolean): string {
  const parts = [];
  const trimmedIssue = issueId.trim();
  if (trimmedIssue.length > 0) parts.push(trimmedIssue);
  if (force) parts.push("--force");
  return parts.join(" ");
}

function readBoardingArguments(input: unknown): { issueId: string; force: boolean } {
  const argumentsValue = readArguments(input);
  const parts = argumentsValue.split(/\s+/).filter(Boolean);
  const force = parts.includes("--force");
  const issueId = parts.filter((part) => part !== "--force").join(" ");
  return { issueId, force };
}

function readPrompt(input: unknown): string {
  if (!isRecord(input)) return "";
  return typeof input.prompt === "string" ? input.prompt : "";
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
