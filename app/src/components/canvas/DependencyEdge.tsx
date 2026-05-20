import {
  BaseEdge,
  useInternalNode,
  type EdgeProps,
  type InternalNode,
  type Node,
} from "@xyflow/react";

const FALLBACK_NODE_WIDTH = 220;
const FALLBACK_NODE_HEIGHT = 96;
const COLUMN_GAP = 24;
const CURVE_MIN = 48;
const CURVE_MAX = 180;
const PORT_SLOT_GAP = 20;
const PORT_SLOT_PADDING = 24;
export const DEPENDENCY_NODE_FALLBACK_WIDTH = FALLBACK_NODE_WIDTH;
export const DEPENDENCY_NODE_FALLBACK_HEIGHT = FALLBACK_NODE_HEIGHT;

export type DependencyEndpointSide = "top" | "right" | "bottom" | "left";

export type DependencyEndpointHint = {
  side: DependencyEndpointSide;
  offset: number;
};

export type DependencyAnchor = {
  x: number;
  y: number;
  side: DependencyEndpointSide;
  dir: {
    x: number;
    y: number;
  };
};

export type DependencyRoute = {
  source: DependencyAnchor;
  target: DependencyAnchor;
};

export type DependencyNodeRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type RouteSlot = {
  index: number;
  count: number;
};

export type RouteSlotData = {
  source: RouteSlot;
  target: RouteSlot;
};

export function DependencyEdge({
  id,
  source,
  target,
  sourceX,
  sourceY,
  targetX,
  targetY,
  markerEnd,
  style,
  interactionWidth,
  data,
}: EdgeProps) {
  const sourceNode = useInternalNode(source);
  const targetNode = useInternalNode(target);
  const routeSlot = readDependencyRouteSlotData(data);
  const route =
    sourceNode && targetNode
      ? getDependencyRoute(sourceNode, targetNode, routeSlot)
      : getFallbackRoute(sourceX, sourceY, targetX, targetY);
  const path = toFlowCurvePath(route);
  const labelPoint = {
    x: (route.source.x + route.target.x) / 2,
    y: (route.source.y + route.target.y) / 2,
  };

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        labelX={labelPoint.x}
        labelY={labelPoint.y}
        markerEnd={markerEnd}
        style={style}
        interactionWidth={interactionWidth}
      />
      <circle
        aria-hidden="true"
        className="dependency-edge__endpoint dependency-edge__endpoint--source"
        cx={route.source.x}
        cy={route.source.y}
        r={3.4}
        data-testid="dependency-edge-source-endpoint"
      />
      <circle
        aria-hidden="true"
        className="dependency-edge__endpoint dependency-edge__endpoint--target"
        cx={route.target.x}
        cy={route.target.y}
        r={3.4}
        data-testid="dependency-edge-target-endpoint"
      />
    </>
  );
}

function getDependencyRoute(
  sourceNode: InternalNode<Node>,
  targetNode: InternalNode<Node>,
  routeSlot: RouteSlotData,
): DependencyRoute {
  return getDependencyRouteForRects(
    getNodeRect(sourceNode),
    getNodeRect(targetNode),
    routeSlot,
  );
}

export function getDependencyRouteForRects(
  sourceRect: DependencyNodeRect,
  targetRect: DependencyNodeRect,
  routeSlot: RouteSlotData,
): DependencyRoute {
  const sourceCenter = {
    x: sourceRect.x + sourceRect.width / 2,
    y: sourceRect.y + sourceRect.height / 2,
  };
  const targetCenter = {
    x: targetRect.x + targetRect.width / 2,
    y: targetRect.y + targetRect.height / 2,
  };
  const dx = targetCenter.x - sourceCenter.x;
  const dy = targetCenter.y - sourceCenter.y;
  const horizontalGap =
    dx >= 0
      ? targetRect.x - (sourceRect.x + sourceRect.width)
      : sourceRect.x - (targetRect.x + targetRect.width);
  const shouldRouteSideways = horizontalGap > COLUMN_GAP;

  if (shouldRouteSideways) {
    const sourceY = offsetInsideSpan(
      sourceCenter.y,
      sourceRect.height,
      routeSlot.source,
    );
    const targetX = offsetInsideSpan(
      targetCenter.x,
      targetRect.width,
      routeSlot.target,
    );
    const targetY = offsetInsideSpan(
      targetCenter.y,
      targetRect.height,
      routeSlot.target,
    );
    return {
      source:
        dx >= 0
          ? rightAnchor(sourceRect, sourceY)
          : leftAnchor(sourceRect, sourceY),
      target: shouldDockSideTargetVertically(dy, targetRect)
        ? verticalSideBranchTargetAnchor(targetRect, targetX, dx, dy)
        : dx >= 0
          ? leftAnchor(targetRect, targetY)
          : rightAnchor(targetRect, targetY),
    };
  }

  const sourceX = offsetInsideSpan(
    sourceCenter.x,
    sourceRect.width,
    routeSlot.source,
  );
  const targetX = offsetInsideSpan(
    targetCenter.x,
    targetRect.width,
    routeSlot.target,
  );
  return {
    source:
      dy >= 0
        ? bottomAnchor(sourceRect, sourceX)
        : topAnchor(sourceRect, sourceX),
    target:
      dy >= 0
        ? topAnchor(targetRect, targetX)
        : bottomAnchor(targetRect, targetX),
  };
}

export function toDependencyEndpointHint(
  anchor: DependencyAnchor,
  rect: DependencyNodeRect,
): DependencyEndpointHint {
  const center = {
    x: rect.x + rect.width / 2,
    y: rect.y + rect.height / 2,
  };
  return {
    side: anchor.side,
    offset:
      anchor.side === "top" || anchor.side === "bottom"
        ? Math.round(anchor.x - center.x)
        : Math.round(anchor.y - center.y),
  };
}

function offsetInsideSpan(
  center: number,
  span: number,
  slot: RouteSlot,
): number {
  if (slot.count <= 1) return center;
  const maxOffset = Math.max(0, span / 2 - PORT_SLOT_PADDING);
  const rawOffset = (slot.index - (slot.count - 1) / 2) * PORT_SLOT_GAP;
  const offset = Math.max(-maxOffset, Math.min(maxOffset, rawOffset));
  return Math.round(center + offset);
}

export function readDependencyRouteSlotData(data: unknown): RouteSlotData {
  if (!isRecord(data) || !isRecord(data.routeSlot)) {
    return DEFAULT_ROUTE_SLOT_DATA;
  }
  return {
    source: readRouteSlot(data.routeSlot.source),
    target: readRouteSlot(data.routeSlot.target),
  };
}

function readRouteSlot(value: unknown): RouteSlot {
  if (!isRecord(value)) return DEFAULT_ROUTE_SLOT;
  const index = typeof value.index === "number" ? value.index : 0;
  const count = typeof value.count === "number" ? value.count : 1;
  return {
    index: Math.max(0, index),
    count: Math.max(1, count),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object";
}

const DEFAULT_ROUTE_SLOT: RouteSlot = { index: 0, count: 1 };
const DEFAULT_ROUTE_SLOT_DATA: RouteSlotData = {
  source: DEFAULT_ROUTE_SLOT,
  target: DEFAULT_ROUTE_SLOT,
};

function getFallbackRoute(
  sourceX: number,
  sourceY: number,
  targetX: number,
  targetY: number,
): DependencyRoute {
  const horizontal = Math.abs(targetX - sourceX) > Math.abs(targetY - sourceY);
  return {
    source: {
      x: sourceX,
      y: sourceY,
      side: horizontal
        ? Math.sign(targetX - sourceX) >= 0
          ? "right"
          : "left"
        : Math.sign(targetY - sourceY) >= 0
          ? "bottom"
          : "top",
      dir: horizontal
        ? { x: Math.sign(targetX - sourceX) || 1, y: 0 }
        : { x: 0, y: Math.sign(targetY - sourceY) || 1 },
    },
    target: {
      x: targetX,
      y: targetY,
      side: horizontal
        ? Math.sign(sourceX - targetX) >= 0
          ? "right"
          : "left"
        : Math.sign(sourceY - targetY) >= 0
          ? "bottom"
          : "top",
      dir: horizontal
        ? { x: Math.sign(sourceX - targetX) || -1, y: 0 }
        : { x: 0, y: Math.sign(sourceY - targetY) || -1 },
    },
  };
}

function toFlowCurvePath(route: DependencyRoute): string {
  const { source, target } = route;
  const distance = Math.hypot(target.x - source.x, target.y - source.y);
  const curve = Math.min(
    CURVE_MAX,
    Math.max(CURVE_MIN, distance * 0.35),
  );
  const sourceControl = {
    x: source.x + source.dir.x * curve,
    y: source.y + source.dir.y * curve,
  };
  const targetControl = {
    x: target.x + target.dir.x * curve,
    y: target.y + target.dir.y * curve,
  };

  return [
    `M ${source.x} ${source.y}`,
    `C ${sourceControl.x} ${sourceControl.y}`,
    `${targetControl.x} ${targetControl.y}`,
    `${target.x} ${target.y}`,
  ].join(" ");
}

function shouldDockSideTargetVertically(
  dy: number,
  targetRect: DependencyNodeRect,
): boolean {
  return Math.abs(dy) > targetRect.height * 0.75;
}

function verticalSideBranchTargetAnchor(
  rect: DependencyNodeRect,
  x: number,
  dx: number,
  dy: number,
): DependencyAnchor {
  if (dy > 0 || (dx < 0 && dy < 0)) {
    return topAnchor(rect, x);
  }
  return bottomAnchor(rect, x);
}

function topAnchor(rect: DependencyNodeRect, x: number): DependencyAnchor {
  return { x, y: rect.y, side: "top", dir: { x: 0, y: -1 } };
}

function bottomAnchor(rect: DependencyNodeRect, x: number): DependencyAnchor {
  return {
    x,
    y: rect.y + rect.height,
    side: "bottom",
    dir: { x: 0, y: 1 },
  };
}

function leftAnchor(rect: DependencyNodeRect, y: number): DependencyAnchor {
  return { x: rect.x, y, side: "left", dir: { x: -1, y: 0 } };
}

function rightAnchor(rect: DependencyNodeRect, y: number): DependencyAnchor {
  return {
    x: rect.x + rect.width,
    y,
    side: "right",
    dir: { x: 1, y: 0 },
  };
}

function getNodeRect(node: InternalNode<Node>): DependencyNodeRect {
  return {
    x: node.internals.positionAbsolute.x,
    y: node.internals.positionAbsolute.y,
    width: node.measured.width ?? node.width ?? FALLBACK_NODE_WIDTH,
    height: node.measured.height ?? node.height ?? FALLBACK_NODE_HEIGHT,
  };
}

export const edgeTypes = {
  dependency: DependencyEdge,
};
