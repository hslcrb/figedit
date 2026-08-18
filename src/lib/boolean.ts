import type { FigmaNode } from "../types/figma";
import type { LabelPath, PathPoint } from "../types/design";
import { rectanglePath } from "./path";

export type BasicBooleanMode = "UNION" | "SUBTRACT";

function ellipsePoints(node: FigmaNode): PathPoint[] {
  const width = node.width ?? 0;
  const height = node.height ?? 0;
  const points: PathPoint[] = [];
  for (let index = 0; index < 16; index += 1) {
    const angle = (index / 16) * Math.PI * 2;
    points.push({ x: (node.x ?? 0) + width / 2 + Math.cos(angle) * width / 2, y: (node.y ?? 0) + height / 2 + Math.sin(angle) * height / 2 });
  }
  return points;
}

function nodePath(node: FigmaNode): PathPoint[] | null {
  if (node.rotation) return null;
  if (node.type === "RECTANGLE") return rectanglePath(node.width ?? 0, node.height ?? 0, node.x ?? 0, node.y ?? 0).points;
  if (node.type === "ELLIPSE") return ellipsePoints(node);
  if (node.type === "VECTOR" && node.labelPath?.closed) return node.labelPath.points.map((point) => ({ ...point, x: point.x + (node.x ?? 0), y: point.y + (node.y ?? 0) }));
  return null;
}

export function combineBasicNodes(nodes: FigmaNode[], mode: BasicBooleanMode): LabelPath | null {
  if (nodes.length !== 2) return null;
  const first = nodePath(nodes[0]);
  const second = nodePath(nodes[1]);
  if (!first || !second) return null;
  return {
    version: 1,
    fillRule: mode === "SUBTRACT" ? "EVENODD" : "NONZERO",
    closed: true,
    points: first,
    subpaths: [first, second],
  };
}

export function booleanSubpaths(nodes: FigmaNode[], mode: BasicBooleanMode): PathPoint[][] | null {
  if (nodes.length !== 2) return null;
  const first = nodePath(nodes[0]);
  const second = nodePath(nodes[1]);
  if (!first || !second) return null;
  return mode === "SUBTRACT" ? [first, second] : [first, second];
}
