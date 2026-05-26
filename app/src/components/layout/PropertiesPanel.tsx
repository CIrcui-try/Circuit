import { useEffect, useState } from "react";
import { ArrowLeftRight } from "lucide-react";
import type { SkillInputHint } from "../../host/bridge";
import { useRunStore } from "../../runner/runStore";
import { defaultSkillFileForLegacySystemId } from "../../skills/defaultSkillFiles";
import { useRepositoryStore } from "../../stores/repositoryStore";
import { useSkillStore, type SkillProvider } from "../../stores/skillStore";
import { useWorkflowStore } from "../../stores/workflowStore";

const EMPTY_INPUT_HINTS: SkillInputHint[] = [];
const MODEL_OPTIONS_BY_PROVIDER: Record<string, string[]> = {
  claude: ["sonnet", "opus"],
  codex: ["gpt-5.5", "gpt-5.4", "gpt-5.4-mini", "gpt-5.3-codex", "gpt-5.2"],
};

type InputEditorMode = "friendly" | "json";

export function PropertiesPanel({ onCollapse }: { onCollapse?: () => void }) {
  const setNodeInput = useWorkflowStore((s) => s.setNodeInput);
  const setNodeModel = useWorkflowStore((s) => s.setNodeModel);
  const changeRepositorySkillRef = useWorkflowStore((s) => s.changeRepositorySkillRef);
  const changeRepositorySkillProvider = useSkillStore(
    (s) => s.changeRepositorySkillProvider,
  );
  const [inputMode, setInputMode] = useState<InputEditorMode>("friendly");
  const [jsonDraft, setJsonDraft] = useState("{}");
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [providerChangeOpen, setProviderChangeOpen] = useState(false);
  const [providerChangeError, setProviderChangeError] = useState<string | null>(null);
  const [providerChangeBusy, setProviderChangeBusy] = useState(false);
  const selectedNode = useWorkflowStore((s) =>
    s.selectedNodeId
      ? s.nodes.find((n) => n.id === s.selectedNodeId) ?? null
      : null,
  );
  const selectedNodeId = selectedNode?.id ?? null;
  const selectedRepositoryId = useRepositoryStore((s) => s.selectedId);
  const selectedRepository = useRepositoryStore((s) =>
    s.repositories.find((repo) => repo.id === s.selectedId) ?? null,
  );
  const runState = useRunStore((s) =>
    selectedNodeId
      ? s.getRunForRepository(selectedRepositoryId).nodeStates[selectedNodeId] ??
        "idle"
      : "idle",
  );
  const debug = useRunStore((s) =>
    selectedNodeId
      ? s.getRunForRepository(selectedRepositoryId).nodeDebug[selectedNodeId] ??
        null
      : null,
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
          selectedNode.data.skillRef.systemSkillId,
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
  const modelValue =
    typeof selectedNode?.data.execution?.model === "string"
      ? selectedNode.data.execution.model
      : "";
  const modelOptions = modelOptionsForProvider(
    selectedNode?.data.skillRef.provider,
  );
  const modelListId = selectedNode
    ? `node-execution-model-options-${selectedNode.data.skillRef.provider}`
    : undefined;
  const providerChange = selectedNode
    ? providerChangeDetails(selectedNode.data.skillRef)
    : null;

  useEffect(() => {
    setInputMode("friendly");
    setJsonDraft(selectedInputJson);
    setJsonError(null);
    setProviderChangeOpen(false);
    setProviderChangeError(null);
    setProviderChangeBusy(false);
  }, [selectedNodeId]);

  useEffect(() => {
    if (inputMode === "json" && jsonError === null) {
      setJsonDraft(selectedInputJson);
    }
  }, [inputMode, jsonError, selectedInputJson]);

  const handleFriendlyChange = (key: "arguments" | "prompt", value: string) => {
    if (!selectedNodeId) return;
    const next = selectedInput ? { ...selectedInput } : {};
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

  const handleModelChange = (value: string) => {
    if (!selectedNodeId) return;
    setNodeModel(selectedNodeId, value);
  };

  const handleProviderChange = async () => {
    if (!selectedRepository || !providerChange) return;
    setProviderChangeBusy(true);
    setProviderChangeError(null);
    try {
      const changedSkill = await changeRepositorySkillProvider(
        selectedRepository.id,
        selectedRepository.path,
        {
          provider: providerChange.provider,
          slug: providerChange.slug,
          targetProvider: providerChange.targetProvider,
        },
      );
      changeRepositorySkillRef({
        provider: providerChange.provider,
        skillFile: providerChange.skillFile,
        nextProvider: changedSkill.provider,
        nextSkillFile: changedSkill.skillFile,
        nextSkillFileAbsPath: changedSkill.skillFileAbsPath,
      });
      setProviderChangeOpen(false);
    } catch (error) {
      setProviderChangeError(error instanceof Error ? error.message : String(error));
    } finally {
      setProviderChangeBusy(false);
    }
  };

  return (
    <>
    <aside className="workspace__props" data-testid="node-properties-panel">
      <div className="panel-header panel-header--with-actions">
        <span>Properties</span>
        {onCollapse ? (
          <button
            type="button"
            className="panel-header__button"
            data-testid="properties-panel-collapse"
            aria-label="Hide properties panel"
            onClick={onCollapse}
          >
            Hide
          </button>
        ) : null}
      </div>
      {!selectedNode ? (
        <div className="empty-state">Select a node or edge to inspect.</div>
      ) : (
        <div className="properties__body">
          <dl className="properties">
            <dt>Label</dt>
            <dd>{selectedNode.data.label}</dd>
            <dt>Provider</dt>
            <dd className="properties__provider">
              <span>{selectedNode.data.skillRef.provider}</span>
              {providerChange ? (
                <button
                  type="button"
                  className="properties__inline-action"
                  data-testid="node-provider-change"
                  onClick={() => {
                    setProviderChangeOpen(true);
                    setProviderChangeError(null);
                  }}
                >
                  <ArrowLeftRight
                    className="properties__inline-action-icon"
                    size={12}
                    strokeWidth={1.9}
                    aria-hidden="true"
                  />
                  {providerSwitchLabel(providerChange.targetProvider)}
                </button>
              ) : null}
            </dd>
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
                  <div className="properties__friendly-fields">
                    <label className="properties__input-field">
                      <span>{argumentsHint?.label ?? "Arguments"}</span>
                      <textarea
                        data-testid="node-input-arguments"
                        className="properties__textarea"
                        aria-label={
                          argumentsHint
                            ? `Node input ${argumentsHint.label}`
                            : "Node input arguments"
                        }
                        placeholder={argumentsHint?.placeholder ?? "Arguments"}
                        value={argumentsValue}
                        onChange={(e) =>
                          handleFriendlyChange("arguments", e.target.value)
                        }
                      />
                    </label>
                    <label className="properties__input-field">
                      <span>Prompt</span>
                      <textarea
                        data-testid="node-input-prompt"
                        className="properties__textarea"
                        aria-label="Node input prompt"
                        placeholder="Prompt"
                        value={promptValue}
                        onChange={(e) =>
                          handleFriendlyChange("prompt", e.target.value)
                        }
                      />
                    </label>
                  </div>
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
            <dt>Model</dt>
            <dd className="properties__field">
              <label className="properties__input-field">
                <span>Model</span>
                <input
                  data-testid="node-execution-model"
                  className="properties__input"
                  aria-label="Node execution model"
                  list={modelListId}
                  placeholder={modelPlaceholder(
                    selectedNode.data.skillRef.provider,
                  )}
                  value={modelValue}
                  onChange={(e) => handleModelChange(e.target.value)}
                />
                <datalist
                  id={modelListId}
                  data-testid="node-execution-model-options"
                >
                  {modelOptions.map((model) => (
                    <option key={model} value={model} />
                  ))}
                </datalist>
              </label>
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
        </div>
      )}
    </aside>
    {providerChangeOpen && providerChange ? (
      <div className="modal__backdrop">
        <div
          className="modal__panel modal__panel--confirm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="provider-change-title"
          data-testid="provider-change-confirm"
        >
          <h2 id="provider-change-title" className="modal__title">
            {providerSwitchLabel(providerChange.targetProvider)}
          </h2>
          <p className="modal__message">
            Switch this repository skill to{" "}
            {providerDisplayName(providerChange.targetProvider)}.
          </p>
          {providerChangeError ? (
            <div className="properties__error" role="alert">
              {providerChangeError}
            </div>
          ) : null}
          <div className="modal__footer">
            <button
              type="button"
              disabled={providerChangeBusy}
              onClick={() => setProviderChangeOpen(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="button-danger"
              disabled={providerChangeBusy || !selectedRepository}
              data-testid="provider-change-confirm-change"
              onClick={() => void handleProviderChange()}
            >
              <ArrowLeftRight size={14} strokeWidth={1.9} aria-hidden="true" />
              {providerChangeBusy
                ? "Switching..."
                : providerSwitchLabel(providerChange.targetProvider)}
            </button>
          </div>
        </div>
      </div>
    ) : null}
    </>
  );
}

function modelOptionsForProvider(provider: string | undefined): string[] {
  return MODEL_OPTIONS_BY_PROVIDER[provider ?? ""] ?? [];
}

function modelPlaceholder(provider: string): string {
  if (provider === "claude") return "sonnet, opus, or full model name";
  if (provider === "codex") return "Codex model name";
  return "Model name";
}

function providerChangeDetails(skillRef: {
  source?: string;
  provider: SkillProvider;
  skillFile: string;
}) {
  if ((skillRef.source ?? "repository") !== "repository") return null;
  const match = skillRef.skillFile.match(
    /^\.(claude|codex)\/skills\/([A-Za-z0-9_-]+)\/SKILL\.md$/,
  );
  if (!match) return null;
  const provider = skillRef.provider;
  const targetProvider = oppositeProvider(provider);
  const slug = match[2];
  return {
    provider,
    targetProvider,
    slug,
    skillFile: skillRef.skillFile,
    targetSkillFile: `.${targetProvider}/skills/${slug}/SKILL.md`,
  };
}

function oppositeProvider(provider: SkillProvider): SkillProvider {
  return provider === "claude" ? "codex" : "claude";
}

function providerDisplayName(provider: SkillProvider): string {
  return provider === "claude" ? "Claude" : "Codex";
}

function providerSwitchLabel(provider: SkillProvider): string {
  return `Switch to ${providerDisplayName(provider)}`;
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

function formatJsonDraft(input: Record<string, unknown> | null): string {
  return JSON.stringify(input ?? {}, null, 2);
}
