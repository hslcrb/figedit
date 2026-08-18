import type { LabelPath, PathPoint } from "../types/design";

export function pathBounds(path: LabelPath): { x: number; y: number; width: number; height: number } {
  const points = path.subpaths?.flat() ?? path.points;
  if (points.length === 0) return { x: 0, y: 0, width: 1, height: 1 };
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(1, Math.max(...xs) - Math.min(...xs)), height: Math.max(1, Math.max(...ys) - Math.min(...ys)) };
}

function control(point: PathPoint, handle: "handleIn" | "handleOut"): { x: number; y: number } | null {
  const value = point[handle];
  return value ? { x: point.x + value.x, y: point.y + value.y } : null;
}

export function traceLabelPath(context: CanvasRenderingContext2D, path: LabelPath): void {
  context.beginPath();
  const subpaths = path.subpaths ?? [path.points];
  for (const points of subpaths) {
    if (points.length === 0) continue;
    context.moveTo(points[0].x, points[0].y);
    const segmentCount = path.closed ? points.length : points.length - 1;
    for (let index = 0; index < segmentCount; index += 1) {
      const current = points[index];
      const next = points[(index + 1) % points.length];
      const out = control(current, "handleOut");
      const incoming = control(next, "handleIn");
      if (out || incoming) {
        context.bezierCurveTo(out?.x ?? current.x, out?.y ?? current.y, incoming?.x ?? next.x, incoming?.y ?? next.y, next.x, next.y);
      } else {
        context.lineTo(next.x, next.y);
      }
    }
    if (path.closed) context.closePath();
  }
}

function fmt(value: number): string {
  return Math.round(value * 1000) / 1000 + "";
}

export function pathToSvg(path: LabelPath): string {
  const subpaths = path.subpaths ?? [path.points];
  const output: string[] = [];
  for (const points of subpaths) {
    if (points.length === 0) continue;
    let pathOutput = `M ${fmt(points[0].x)} ${fmt(points[0].y)}`;
    const segmentCount = path.closed ? points.length : points.length - 1;
    for (let index = 0; index < segmentCount; index += 1) {
      const current = points[index];
      const next = points[(index + 1) % points.length];
      const out = control(current, "handleOut");
      const incoming = control(next, "handleIn");
      if (out || incoming) pathOutput += ` C ${fmt(out?.x ?? current.x)} ${fmt(out?.y ?? current.y)} ${fmt(incoming?.x ?? next.x)} ${fmt(incoming?.y ?? next.y)} ${fmt(next.x)} ${fmt(next.y)}`;
      else pathOutput += ` L ${fmt(next.x)} ${fmt(next.y)}`;
    }
    if (path.closed) pathOutput += " Z";
    output.push(pathOutput);
  }
  return output.join(" ");
}

export function normalizePath(points: PathPoint[], closed = true): { path: LabelPath; bounds: { x: number; y: number; width: number; height: number } } {
  const bounds = pathBounds({ version: 1, fillRule: "NONZERO", closed: true, points });
  const normalized = points.map((point) => ({
    ...point,
    x: point.x - bounds.x,
    y: point.y - bounds.y,
  }));
  return { path: { version: 1, fillRule: "NONZERO", closed, points: normalized }, bounds };
}

export function rectanglePath(width: number, height: number, x = 0, y = 0): LabelPath {
  return {
    version: 1,
    fillRule: "NONZERO",
    closed: true,
    points: [
      { x, y },
      { x: x + width, y },
      { x: x + width, y: y + height },
      { x, y: y + height },
    ],
  };
}
