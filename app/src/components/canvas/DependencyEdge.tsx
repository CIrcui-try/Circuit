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

type Anchor = {
  x: number;
  y: number;
};

type CurveAxis = "x" | "y";

type DependencyRoute = {
  source: Anchor;
  target: Anchor;
  axis: CurveAxis;
};

type RouteSlot = {
  index: number;
  count: number;
};

type RouteSlotData = {
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
  const routeSlot = readRouteSlotData(data);
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
    <BaseEdge
      id={id}
      path={path}
      labelX={labelPoint.x}
      labelY={labelPoint.y}
      markerEnd={markerEnd}
      style={style}
      interactionWidth={interactionWidth}
    />
  );
}

function getDependencyRoute(
  sourceNode: InternalNode<Node>,
  targetNode: InternalNode<Node>,
  routeSlot: RouteSlotData,
): DependencyRoute {
  const sourceRect = getNodeRect(sourceNode);
  const targetRect = getNodeRect(targetNode);
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
    const targetY = offsetInsideSpan(
      targetCenter.y,
      targetRect.height,
      routeSlot.target,
    );
    const source = {
      x: dx >= 0 ? sourceRect.x + sourceRect.width : sourceRect.x,
      y: sourceY,
    };
    const target = {
      x: dx >= 0 ? targetRect.x : targetRect.x + targetRect.width,
      y: targetY,
    };
    return { source, target, axis: "x" };
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
  const source = {
    x: sourceX,
    y: dy >= 0 ? sourceRect.y + sourceRect.height : sourceRect.y,
  };
  const target = {
    x: targetX,
    y: dy >= 0 ? targetRect.y : targetRect.y + targetRect.height,
  };
  return { source, target, axis: "y" };
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

function readRouteSlotData(data: unknown): RouteSlotData {
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
  return {
    source: { x: sourceX, y: sourceY },
    target: { x: targetX, y: targetY },
    axis: Math.abs(targetX - sourceX) > Math.abs(targetY - sourceY) ? "x" : "y",
  };
}

function toFlowCurvePath(route: DependencyRoute): string {
  const { source, target, axis } = route;
  const delta = axis === "x" ? target.x - source.x : target.y - source.y;
  const direction = Math.sign(delta) || 1;
  const curve = Math.min(
    CURVE_MAX,
    Math.max(CURVE_MIN, Math.abs(delta) * 0.45),
  );
  const sourceControl =
    axis === "x"
      ? { x: source.x + direction * curve, y: source.y }
      : { x: source.x, y: source.y + direction * curve };
  const targetControl =
    axis === "x"
      ? { x: target.x - direction * curve, y: target.y }
      : { x: target.x, y: target.y - direction * curve };

  return [
    `M ${source.x} ${source.y}`,
    `C ${sourceControl.x} ${sourceControl.y}`,
    `${targetControl.x} ${targetControl.y}`,
    `${target.x} ${target.y}`,
  ].join(" ");
}

function getNodeRect(node: InternalNode<Node>) {
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
