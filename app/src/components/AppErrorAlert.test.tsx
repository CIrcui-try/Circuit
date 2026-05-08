import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppErrorAlert, notifyAppError } from "./AppErrorAlert";

afterEach(() => {
  vi.useRealTimers();
});

describe("AppErrorAlert", () => {
  it("dismisses the active alert after 5 seconds", () => {
    vi.useFakeTimers();
    render(<AppErrorAlert />);

    act(() => {
      notifyAppError("Command not found", "Start Circuit failed");
    });

    expect(screen.getByTestId("app-error-alert")).toHaveTextContent(
      "Start Circuit failed",
    );

    act(() => {
      vi.advanceTimersByTime(4999);
    });
    expect(screen.getByTestId("app-error-alert")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByTestId("app-error-alert")).not.toBeInTheDocument();
  });
});
