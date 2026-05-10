import { useRunStore } from "../../runner/runStore";
import { useWorkflowStore } from "../../stores/workflowStore";

export function PropertiesPanel() {
  const setNodeInput = useWorkflowStore((s) => s.setNodeInput);
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
  const argumentsValue =
    typeof selectedInput?.arguments === "string" ? selectedInput.arguments : "";

  const handleArgumentsChange = (value: string) => {
    if (!selectedNodeId) return;
    const next = selectedInput ? { ...selectedInput } : {};
    if (value.length > 0) {
      next.arguments = value;
    } else {
      delete next.arguments;
    }
    setNodeInput(selectedNodeId, Object.keys(next).length > 0 ? next : null);
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
          <dt>Skill File</dt>
          <dd>
            <code>{selectedNode.data.skillRef.skillFile}</code>
          </dd>
          <dt>Input</dt>
          <dd className="properties__field">
            <textarea
              data-testid="node-input-arguments"
              className="properties__textarea"
              aria-label="Node input arguments"
              placeholder="<ISSUE-ID> [--force]"
              value={argumentsValue}
              onChange={(e) => handleArgumentsChange(e.target.value)}
            />
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
