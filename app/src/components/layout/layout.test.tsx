import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Sidebar } from "./Sidebar";
import { PropertiesPanel } from "./PropertiesPanel";
import { LogPanel } from "./LogPanel";
import { Canvas } from "./Canvas";

describe("Layout shell", () => {
  it("Sidebar renders header and empty hint", () => {
    render(<Sidebar />);
    expect(screen.getByText("Skills")).toBeInTheDocument();
    expect(screen.getByText(/Skills will appear here/i)).toBeInTheDocument();
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

  it("Canvas mounts a ReactFlow surface without nodes", () => {
    const { container } = render(<Canvas />);
    expect(container.querySelector(".react-flow")).not.toBeNull();
  });
});
