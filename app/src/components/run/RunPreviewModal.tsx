import { useEffect, useMemo, useState } from "react";
import type { WorkflowSkillProvider } from "../../workflow/schema";

export interface RunPreviewNode {
  id: string;
  label: string;
  provider: WorkflowSkillProvider;
  skillFile: string;
  commandSummary: string;
  timeoutMs: number;
  sensitiveKeywords: string[];
}

export interface RunPreviewModalProps {
  open: boolean;
  workflowName: string;
  repoPath: string;
  nodes: RunPreviewNode[];
  allowedProviders: WorkflowSkillProvider[];
  onConfirm(): void;
  onCancel(): void;
}

export function RunPreviewModal(props: RunPreviewModalProps) {
  const {
    open,
    workflowName,
    repoPath,
    nodes,
    allowedProviders,
    onConfirm,
    onCancel,
  } = props;

  const [acknowledged, setAcknowledged] = useState(false);

  useEffect(() => {
    if (open) setAcknowledged(false);
  }, [open]);

  const blockedNodes = useMemo(
    () => nodes.filter((n) => !allowedProviders.includes(n.provider)),
    [nodes, allowedProviders],
  );

  const sensitiveNodes = useMemo(
    () => nodes.filter((n) => n.sensitiveKeywords.length > 0),
    [nodes],
  );

  if (!open) return null;

  const hasBlocked = blockedNodes.length > 0;
  const hasSensitive = sensitiveNodes.length > 0;
  const confirmDisabled = hasBlocked || (hasSensitive && !acknowledged);

  return (
    <div
      className="modal__backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="run-preview-title"
      data-testid="run-preview-modal"
    >
      <div className="modal__panel modal__panel--run-preview">
        <header className="modal__header">
          <h2 id="run-preview-title" className="modal__title">
            Confirm workflow run
          </h2>
        </header>
        <dl className="modal__meta">
          <dt>Workflow</dt>
          <dd data-testid="run-preview-workflow-name">
            {workflowName || "(untitled)"}
          </dd>
          <dt>Repository</dt>
          <dd data-testid="run-preview-repo-path">{repoPath}</dd>
          <dt>Allowed providers</dt>
          <dd data-testid="run-preview-allowlist">
            {allowedProviders.join(", ")}
          </dd>
        </dl>

        {hasBlocked ? (
          <div className="modal__warn" data-testid="run-preview-blocked">
            <strong>Provider not allowed.</strong> The following nodes use a
            provider that is not in the allowlist and will be skipped:
            <ul>
              {blockedNodes.map((n) => (
                <li key={n.id}>
                  <code>{n.id}</code> — {n.provider}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {hasSensitive ? (
          <div className="modal__warn" data-testid="run-preview-sensitive">
            <strong>Sensitive action detected.</strong> The following nodes
            mention potentially destructive keywords:
            <ul>
              {sensitiveNodes.map((n) => (
                <li key={n.id}>
                  <code>{n.id}</code> — {n.sensitiveKeywords.join(", ")}
                </li>
              ))}
            </ul>
            <label className="modal__ack">
              <input
                type="checkbox"
                data-testid="run-preview-ack"
                checked={acknowledged}
                onChange={(e) => setAcknowledged(e.target.checked)}
              />
              <span>I understand the sensitive actions</span>
            </label>
          </div>
        ) : null}

        <table
          className="modal__nodes"
          data-testid="run-preview-nodes"
        >
          <thead>
            <tr>
              <th>Node</th>
              <th>Provider</th>
              <th>Skill file</th>
              <th>Timeout</th>
              <th>Command</th>
            </tr>
          </thead>
          <tbody>
            {nodes.map((n) => (
              <tr key={n.id} data-testid="run-preview-node-row">
                <td>{n.label || n.id}</td>
                <td>{n.provider}</td>
                <td>
                  <code>{n.skillFile}</code>
                </td>
                <td>{n.timeoutMs}ms</td>
                <td>
                  <code>{n.commandSummary}</code>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <footer className="modal__footer">
          <button
            type="button"
            data-testid="run-preview-cancel"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            data-testid="run-preview-confirm"
            onClick={onConfirm}
            disabled={confirmDisabled}
          >
            Run
          </button>
        </footer>
      </div>
    </div>
  );
}
