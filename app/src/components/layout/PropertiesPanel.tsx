import { useEffect, useState } from "react";
import type { SkillInputHint } from "../../host/bridge";

const EMPTY_INPUT_HINTS: SkillInputHint[] = [];
import { useRunStore } from "../../runner/runStore";
import { useSkillStore } from "../../stores/skillStore";
import { useWorkflowStore } from "../../stores/workflowStore";

type InputEditorMode = "friendly" | "json";

export function PropertiesPanel() {
  const setNodeInput = useWorkflowStore((s) => s.setNodeInput);
  const [inputMode, setInputMode] = useState<InputEditorMode>("friendly");
  const [jsonDraft, setJsonDraft] = useState("{}");
  const [jsonError, setJsonError] = useState<string | null>(null);
  const selectedNode = useWorkflowStore((s) =>
    s.selectedNodeId
      ? s.nodes.find((n) => n.id === s.selectedNodeId) ?? null
      : null,
  );
  const selectedNodeId = selectedNode?.id ?? null;
  const runState = useRunStore((s) =>
    selectedNodeId ? s.nodeStates[selectedNodeId] ?? "idle" : "idle",
  );
  const debug = useRunStore((s) =>
    selectedNodeId ? s.nodeDebug[selectedNodeId] ?? null : null,
  );
  const selectedInput = asRecord(selectedNode?.data.input);
  const selectedInputHints = useSkillStore((state) =>
    selectedNode
      ? findSkillInputHints(
          state.byRepo,
          state.defaultSkills,
          selectedNode.data.skillRef.provider,
          selectedNode.data.skillRef.skillFile,
          selectedNode.data.skillRef.source,
        )
      : EMPTY_INPUT_HINTS,
  );
  const nodeInputHints = readInputHints(selectedNode?.data.inputHints);
  const argumentsHint = (nodeInputHints ?? selectedInputHints).find(
    (hint) => hint.key === "arguments",
  );
  const selectedInputJson = formatJsonDraft(selectedInput);
  const argumentsValue =
    typeof selectedInput?.arguments === "string" ? selectedInput.arguments : "";
  const promptValue =
    typeof selectedInput?.prompt === "string" ? selectedInput.prompt : "";

  useEffect(() => {
    setInputMode("friendly");
    setJsonDraft(selectedInputJson);
    setJsonError(null);
  }, [selectedNodeId]);

  useEffect(() => {
    if (inputMode === "json" && jsonError === null) {
      setJsonDraft(selectedInputJson);
    }
  }, [inputMode, jsonError, selectedInputJson]);

  const handleArgumentsChange = (value: string) => {
    if (!selectedNodeId) return;
    const next = selectedInput ? { ...selectedInput } : {};
    const key = argumentsHint ? "arguments" : "prompt";
    if (value.length > 0) {
      next[key] = value;
    } else {
      delete next[key];
    }
    setNodeInput(selectedNodeId, Object.keys(next).length > 0 ? next : null);
  };

  const handleJsonChange = (value: string) => {
    setJsonDraft(value);
    if (!selectedNodeId) return;

    let parsed: unknown;
    try {
      parsed = JSON.parse(value);
    } catch (error) {
      setJsonError(error instanceof Error ? error.message : "Invalid JSON");
      return;
    }

    if (!isRecord(parsed)) {
      setJsonError("Input JSON must be an object.");
      return;
    }

    setJsonError(null);
    setNodeInput(selectedNodeId, Object.keys(parsed).length > 0 ? parsed : null);
  };

  return (
    <aside className="workspace__props" data-testid="node-properties-panel">
      <div className="panel-header">Properties</div>
      {!selectedNode ? (
        <div className="empty-state">Select a node or edge to inspect.</div>
      ) : (
        <dl className="properties">
          <dt>Label</dt>
          <dd>{selectedNode.data.label}</dd>
          <dt>Provider</dt>
          <dd>{selectedNode.data.skillRef.provider}</dd>
          <dt>
            {selectedNode.data.skillRef.source === "system"
              ? "System Skill"
              : "Skill File"}
          </dt>
          <dd>
            <code>
              {selectedNode.data.skillRef.source === "system"
                ? selectedNode.data.skillRef.systemSkillId
                : selectedNode.data.skillRef.skillFile}
            </code>
          </dd>
          <dt>Input</dt>
          <dd className="properties__field">
            <div className="properties__input-editor">
              <div
                className="properties__segmented"
                role="group"
                aria-label="Input editor mode"
              >
                <button
                  type="button"
                  className={inputMode === "friendly" ? "is-active" : ""}
                  data-testid="node-input-mode-friendly"
                  aria-pressed={inputMode === "friendly"}
                  onClick={() => {
                    setInputMode("friendly");
                    setJsonError(null);
                  }}
                >
                  Friendly
                </button>
                <button
                  type="button"
                  className={inputMode === "json" ? "is-active" : ""}
                  data-testid="node-input-mode-json"
                  aria-pressed={inputMode === "json"}
                  onClick={() => {
                    setInputMode("json");
                    setJsonDraft(selectedInputJson);
                    setJsonError(null);
                  }}
                >
                  JSON
                </button>
              </div>
              {inputMode === "friendly" ? (
                <textarea
                  data-testid="node-input-arguments"
                  className="properties__textarea"
                  aria-label={
                    argumentsHint
                      ? `Node input ${argumentsHint.label}`
                      : "Node input prompt"
                  }
                  placeholder={argumentsHint?.placeholder ?? "Prompt"}
                  value={argumentsHint ? argumentsValue : promptValue}
                  onChange={(e) => handleArgumentsChange(e.target.value)}
                />
              ) : (
                <>
                  <textarea
                    data-testid="node-input-json"
                    className="properties__textarea properties__textarea--json"
                    aria-label="Node input JSON"
                    aria-invalid={jsonError !== null}
                    value={jsonDraft}
                    onChange={(e) => handleJsonChange(e.target.value)}
                  />
                  {jsonError ? (
                    <div className="properties__error" role="alert">
                      {jsonError}
                    </div>
                  ) : null}
                </>
              )}
            </div>
          </dd>
          <dt>Run Status</dt>
          <dd data-testid="node-run-status">{formatRunState(runState)}</dd>
          {debug?.adapter ? (
            <>
              <dt>Adapter</dt>
              <dd>{debug.adapter}</dd>
            </>
          ) : null}
          {debug?.command ? (
            <>
              <dt>Command</dt>
              <dd>
                <code>{debug.command}</code>
              </dd>
            </>
          ) : null}
          {debug?.spawnType ? (
            <>
              <dt>Spawn</dt>
              <dd>{debug.spawnType}</dd>
            </>
          ) : null}
          {debug?.startedAt ? (
            <>
              <dt>Started</dt>
              <dd>{debug.startedAt}</dd>
            </>
          ) : null}
          {debug?.durationMs != null ? (
            <>
              <dt>Duration</dt>
              <dd>{debug.durationMs}ms</dd>
            </>
          ) : null}
          {debug?.exitCode != null ? (
            <>
              <dt>Exit Code</dt>
              <dd>{debug.exitCode}</dd>
            </>
          ) : null}
          {debug?.lastLogAt ? (
            <>
              <dt>Last Log</dt>
              <dd>{debug.lastLogAt}</dd>
            </>
          ) : null}
          {debug?.idleSince ? (
            <>
              <dt>Idle Since</dt>
              <dd>{debug.idleSince}</dd>
            </>
          ) : null}
        </dl>
      )}
    </aside>
  );
}

function formatRunState(state: string): string {
  if (state === "queued") return "pending";
  if (state === "waiting_input") return "waiting for input";
  return state;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function findSkillInputHints(
  byRepo: ReturnType<typeof useSkillStore.getState>["byRepo"],
  defaultSkills: ReturnType<typeof useSkillStore.getState>["defaultSkills"],
  provider: string,
  skillFile: string,
  source: string | undefined,
): SkillInputHint[] {
  const collections =
    source === "default" ? [defaultSkills] : Object.values(byRepo);
  for (const skills of collections) {
    const match = skills.find(
      (skill) => skill.provider === provider && skill.skillFile === skillFile,
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

function formatJsonDraft(input: Record<string, unknown> | null): string {
  return JSON.stringify(input ?? {}, null, 2);
}
