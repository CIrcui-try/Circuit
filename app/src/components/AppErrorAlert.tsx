import { useEffect, useState } from "react";

const APP_ERROR_EVENT = "circuit:error";
const APP_ERROR_AUTO_DISMISS_MS = 5000;

type AppErrorPayload = {
  title?: string;
  message: string;
};

type AppErrorState = {
  title: string;
  message: string;
};

export function formatErrorMessage(value: unknown): string {
  if (value instanceof Error && value.message) return value.message;
  if (typeof value === "string") return value.trim() || "Unknown error";
  if (
    value &&
    typeof value === "object" &&
    "message" in value &&
    typeof value.message === "string" &&
    value.message.trim()
  ) {
    return value.message;
  }
  if (value == null) return "Unknown error";
  try {
    const json = JSON.stringify(value);
    if (json && json !== "{}") return json;
  } catch {}
  return String(value);
}

export function notifyAppError(error: unknown, title = "Error") {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<AppErrorPayload>(APP_ERROR_EVENT, {
      detail: { title, message: formatErrorMessage(error) },
    }),
  );
}

function payloadFromEvent(event: Event): AppErrorPayload | null {
  if (!(event instanceof CustomEvent)) return null;
  const detail = event.detail as Partial<AppErrorPayload> | undefined;
  if (!detail || typeof detail.message !== "string") return null;
  return {
    title: detail.title,
    message: detail.message,
  };
}

export function AppErrorAlert() {
  const [alert, setAlert] = useState<AppErrorState | null>(null);

  useEffect(() => {
    const show = (title: string, message: string) => {
      setAlert({ title, message });
    };

    const onAppError = (event: Event) => {
      const payload = payloadFromEvent(event);
      if (!payload) return;
      show(payload.title ?? "Error", payload.message);
    };

    const onError = (event: ErrorEvent) => {
      show("Unexpected error", formatErrorMessage(event.error ?? event.message));
    };

    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      show("Unhandled async error", formatErrorMessage(event.reason));
    };

    window.addEventListener(APP_ERROR_EVENT, onAppError);
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onUnhandledRejection);
    return () => {
      window.removeEventListener(APP_ERROR_EVENT, onAppError);
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
    };
  }, []);

  useEffect(() => {
    if (!alert) return;
    const timeoutId = window.setTimeout(() => {
      setAlert(null);
    }, APP_ERROR_AUTO_DISMISS_MS);
    return () => window.clearTimeout(timeoutId);
  }, [alert]);

  if (!alert) return null;

  return (
    <div className="app-error-alert" role="alert" data-testid="app-error-alert">
      <div className="app-error-alert__content">
        <strong className="app-error-alert__title">{alert.title}</strong>
        <span className="app-error-alert__message">{alert.message}</span>
      </div>
      <button
        type="button"
        className="app-error-alert__dismiss"
        aria-label="Dismiss error"
        onClick={() => setAlert(null)}
      >
        ×
      </button>
    </div>
  );
}
