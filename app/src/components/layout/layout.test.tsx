import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("../../host/bridge", () => ({
  getHostBridge: () => ({
    openRepositoryDialog: vi.fn(),
    scanSkills: vi.fn(async () => []),
    loadRepositories: vi.fn(async () => null),
    saveRepositories: vi.fn(async () => {}),
  }),
}));

import { Sidebar } from "./Sidebar";
import { PropertiesPanel } from "./PropertiesPanel";
import { LogPanel } from "./LogPanel";
import { Canvas } from "./Canvas";
import { nodeTypes } from "../canvas/SkillNode";
import { useWorkflowStore } from "../../stores/workflowStore";

beforeEach(() => {
  useWorkflowStore.getState().resetWorkflow();
});

describe("Layout shell", () => {
  it("Sidebar renders header and 'no repository selected' empty hint", () => {
    render(<Sidebar />);
    expect(screen.getByText("Skills")).toBeInTheDocument();
    expect(screen.getByText(/No repository selected/i)).toBeInTheDocument();
  });

  it("PropertiesPanel renders header and empty hint", () => {
    render(<PropertiesPanel />);
    expect(screen.getByText("Properties")).toBeInTheDocument();
    expect(screen.getByText(/Select a node or edge/i)).toBeInTheDocument();
  });

  it("LogPanel renders header and empty hint", () => {
    render(<LogPanel />);
    expect(screen.getByText("Run Log")).toBeInTheDocument();
    expect(screen.getByText("No runs yet.")).toBeInTheDocument();
  });

  it("Canvas mounts a ReactFlow surface", () => {
    const { container } = render(<Canvas />);
    expect(container.querySelector(".react-flow")).not.toBeNull();
    expect(screen.getByTestId("workflow-canvas")).toBeInTheDocument();
  });

  it("nodeTypes registers a 'skill' custom node", () => {
    expect(nodeTypes.skill).toBeDefined();
  });
});
