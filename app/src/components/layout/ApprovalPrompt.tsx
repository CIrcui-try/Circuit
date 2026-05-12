import { useState } from "react";
import type { PendingApproval } from "../../runner/runLogStore";
import type { WorkflowSkillProvider } from "../../workflow/schema";

export interface ApprovalPromptProps {
  request: PendingApproval;
  nodeMeta?: {
    label: string;
    provider?: WorkflowSkillProvider;
  };
  onRespond: (text: string) => void | Promise<void>;
  onDismiss?: () => void;
}

export function ApprovalPrompt({
  request,
  nodeMeta,
  onRespond,
  onDismiss,
}: ApprovalPromptProps) {
  const [freeform, setFreeform] = useState("");
  const [busy, setBusy] = useState(false);

  const respond = async (text: string) => {
    if (busy) return;
    setBusy(true);
    try {
      await onRespond(text);
    } finally {
      setBusy(false);
    }
  };

  return (
    <li
      className={`run-log__line run-log__line--approval run-log__line--approval-${request.approvalKind}`}
      data-testid="approval-prompt"
      data-request-id={request.requestId}
    >
      {nodeMeta?.provider ? (
        <span
          className={`run-log__node run-log__provider skill-list__chip skill-list__chip--${nodeMeta.provider}`}
          data-testid="run-log-provider"
        >
          {nodeMeta.provider}
        </span>
      ) : (
        <span className="run-log__node run-log__provider">-</span>
      )}
      <span
        className="run-log__node run-log__skill"
        data-testid="run-log-skill"
        title={request.nodeId}
      >
        {nodeMeta?.label ?? request.nodeId}
      </span>
      <span className="run-log__type">approval</span>
      <span className="run-log__payload run-log__payload--approval">
        <span className="approval__prompt">{request.prompt}</span>
        {request.approvalKind === "freeform" ? (
          <span className="approval__freeform">
            <input
              data-testid="approval-input"
              value={freeform}
              disabled={busy}
              onChange={(e) => setFreeform(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void respond(`${freeform}\n`);
              }}
            />
            <button
              type="button"
              data-testid="approval-send"
              disabled={busy}
              onClick={() => void respond(`${freeform}\n`)}
            >
              Send
            </button>
          </span>
        ) : (
          <span className="approval__choices">
            <button
              type="button"
              data-testid="approval-allow"
              disabled={busy}
              onClick={() => void respond("y\n")}
            >
              Allow
            </button>
            <button
              type="button"
              data-testid="approval-deny"
              disabled={busy}
              onClick={() => void respond("n\n")}
            >
              Deny
            </button>
          </span>
        )}
        {onDismiss ? (
          <button
            type="button"
            data-testid="approval-dismiss"
            className="approval__dismiss"
            disabled={busy}
            onClick={() => onDismiss()}
            aria-label="dismiss approval"
          >
            ×
          </button>
        ) : null}
      </span>
    </li>
  );
}
