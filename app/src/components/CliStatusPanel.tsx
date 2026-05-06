import { useEffect } from "react";
import {
  useCliStatusStore,
  type CliEntry,
  type CliId,
  type CliStatus,
} from "../stores/cliStatusStore";

const CLI_LABELS: Record<CliId, string> = {
  claude: "Claude CLI",
  codex: "Codex CLI",
};

const STATUS_LABEL: Record<CliStatus, string> = {
  idle: "확인 전",
  checking: "점검 중…",
  ok: "사용 가능",
  missing: "설치되지 않음",
  error: "오류",
};

function describe(entry: CliEntry): string {
  switch (entry.status) {
    case "ok":
      return entry.version ?? "사용 가능";
    case "missing":
      return entry.errorMessage ?? "PATH에서 찾을 수 없음";
    case "error":
      return entry.errorMessage ?? "오류";
    case "checking":
      return entry.progressLabel ?? "점검 중…";
    case "idle":
    default:
      return "확인 전";
  }
}

export function CliStatusPanel() {
  const entries = useCliStatusStore((s) => s.entries);
  const isChecking = useCliStatusStore((s) => s.isChecking);
  const runChecks = useCliStatusStore((s) => s.runChecks);

  useEffect(() => {
    void runChecks();
  }, [runChecks]);

  const ids: CliId[] = ["claude", "codex"];

  return (
    <section className="cli-status-panel" data-testid="cli-status-panel">
      <header className="cli-status-panel__header">
        <span className="cli-status-panel__title">CLI 상태</span>
        <button
          type="button"
          className="cli-status-panel__refresh"
          onClick={() => void runChecks()}
          disabled={isChecking}
          data-testid="cli-status-refresh"
        >
          {isChecking ? (
            <>
              <span
                className="cli-status-spinner cli-status-spinner--inline"
                aria-hidden="true"
                role="presentation"
              />
              점검 중…
            </>
          ) : (
            "다시 점검"
          )}
        </button>
      </header>
      <div className="cli-status-panel__list">
        {ids.map((id) => {
          const entry = entries[id];
          return (
            <div
              key={id}
              className="cli-status-row"
              data-testid={`cli-status-row-${id}`}
              data-status={entry.status}
            >
              {entry.status === "checking" ? (
                <span
                  className="cli-status-spinner"
                  aria-hidden="true"
                  role="presentation"
                />
              ) : (
                <span
                  className={`cli-status-dot cli-status-dot--${entry.status}`}
                  aria-hidden="true"
                />
              )}
              <span className="cli-status-row__name">{CLI_LABELS[id]}</span>
              <span
                className="cli-status-row__detail"
                title={describe(entry)}
              >
                {describe(entry)}
              </span>
              <span className="cli-status-row__sr">
                {STATUS_LABEL[entry.status]}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
