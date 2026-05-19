import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Position, useInternalNode, type EdgeProps } from "@xyflow/react";
import { DependencyEdge } from "./DependencyEdge";

vi.mock("@xyflow/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@xyflow/react")>();
  return {
    ...actual,
    BaseEdge: ({ id, path }: { id?: string; path: string }) => (
      <path data-testid="dependency-edge-path" data-edge-id={id} d={path} />
    ),
    useInternalNode: vi.fn(),
  };
});

const useInternalNodeMock = vi.mocked(useInternalNode);

describe("DependencyEdge", () => {
  it("renders endpoint dots at fallback edge coordinates", () => {
    useInternalNodeMock.mockReturnValue(undefined);

    render(
      <svg>
        <DependencyEdge
          {...edgeProps({ sourceX: 10, sourceY: 20, targetX: 90, targetY: 30 })}
        />
      </svg>,
    );

    expect(screen.getByTestId("dependency-edge-source-endpoint")).toHaveAttribute(
      "cx",
      "10",
    );
    expect(screen.getByTestId("dependency-edge-source-endpoint")).toHaveAttribute(
      "cy",
      "20",
    );
    expect(screen.getByTestId("dependency-edge-target-endpoint")).toHaveAttribute(
      "cx",
      "90",
    );
    expect(screen.getByTestId("dependency-edge-target-endpoint")).toHaveAttribute(
      "cy",
      "30",
    );
  });

  it("renders endpoint dots at computed dependency route coordinates", () => {
    useInternalNodeMock.mockImplementation((nodeId) =>
      nodeId === "source"
        ? internalNode({ x: 100, y: 50, width: 220, height: 96 })
        : internalNode({ x: 400, y: 80, width: 220, height: 96 }),
    );

    render(
      <svg>
        <DependencyEdge
          {...edgeProps({ sourceX: 0, sourceY: 0, targetX: 0, targetY: 0 })}
        />
      </svg>,
    );

    expect(screen.getByTestId("dependency-edge-source-endpoint")).toHaveAttribute(
      "cx",
      "320",
    );
    expect(screen.getByTestId("dependency-edge-source-endpoint")).toHaveAttribute(
      "cy",
      "98",
    );
    expect(screen.getByTestId("dependency-edge-target-endpoint")).toHaveAttribute(
      "cx",
      "400",
    );
    expect(screen.getByTestId("dependency-edge-target-endpoint")).toHaveAttribute(
      "cy",
      "128",
    );
  });
});

function edgeProps(
  positions: Pick<EdgeProps, "sourceX" | "sourceY" | "targetX" | "targetY">,
): EdgeProps {
  return {
    id: "source-target",
    source: "source",
    target: "target",
    sourcePosition: Position.Right,
    targetPosition: Position.Left,
    selected: false,
    animated: false,
    markerStart: undefined,
    markerEnd: undefined,
    style: undefined,
    interactionWidth: 18,
    data: undefined,
    ...positions,
  } as EdgeProps;
}

function internalNode({
  x,
  y,
  width,
  height,
}: {
  x: number;
  y: number;
  width: number;
  height: number;
}) {
  return {
    internals: {
      positionAbsolute: { x, y },
    },
    measured: { width, height },
    width,
    height,
  } as ReturnType<typeof useInternalNode>;
}
