import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AppErrorAlert, notifyAppError, notifyAppSuccess } from "./AppErrorAlert";

afterEach(() => {
  vi.useRealTimers();
});

function renderWithRoutes(initialEntry = "/") {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <AppErrorAlert />
      <Routes>
        <Route path="/" element={<div data-testid="home-route">Home</div>} />
        <Route
          path="/workspace/:repoId"
          element={<div data-testid="workspace-route">Workspace</div>}
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe("AppErrorAlert", () => {
  it("dismisses the active alert after 5 seconds", () => {
    vi.useFakeTimers();
    renderWithRoutes();

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

  it("navigates to the repository workspace when clicking alert content", () => {
    renderWithRoutes();

    act(() => {
      notifyAppError("Command not found", "Start Circuit failed", {
        repositoryId: "id-alpha",
      });
    });

    fireEvent.click(screen.getByText("Command not found"));

    expect(screen.getByTestId("workspace-route")).toBeInTheDocument();
  });

  it("dismisses a repository alert without navigating when clicking dismiss", () => {
    renderWithRoutes();

    act(() => {
      notifyAppError("Command not found", "Start Circuit failed", {
        repositoryId: "id-alpha",
      });
    });

    fireEvent.click(screen.getByRole("button", { name: "Dismiss error" }));

    expect(screen.queryByTestId("app-error-alert")).not.toBeInTheDocument();
    expect(screen.getByTestId("home-route")).toBeInTheDocument();
  });

  it("shows a success alert that can navigate to the repository workspace", () => {
    renderWithRoutes();

    act(() => {
      notifyAppSuccess("Release flow in alpha", "Workflow completed", {
        repositoryId: "id-alpha",
      });
    });

    expect(screen.getByRole("status")).toHaveTextContent("Workflow completed");

    fireEvent.click(screen.getByText("Release flow in alpha"));

    expect(screen.getByTestId("workspace-route")).toBeInTheDocument();
  });
});
