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
}: EdgeProps) {
  const sourceNode = useInternalNode(source);
  const targetNode = useInternalNode(target);
  const route =
    sourceNode && targetNode
      ? getDependencyRoute(sourceNode, targetNode)
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
    const source = {
      x: dx >= 0 ? sourceRect.x + sourceRect.width : sourceRect.x,
      y: sourceCenter.y,
    };
    const target = {
      x: dx >= 0 ? targetRect.x : targetRect.x + targetRect.width,
      y: targetCenter.y,
    };
    return { source, target, axis: "x" };
  }

  const source = {
    x: sourceCenter.x,
    y: dy >= 0 ? sourceRect.y + sourceRect.height : sourceRect.y,
  };
  const target = {
    x: targetCenter.x,
    y: dy >= 0 ? targetRect.y : targetRect.y + targetRect.height,
  };
  return { source, target, axis: "y" };
}

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
