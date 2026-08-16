import type { FigmaNode, Paint } from "../types/figma";
import { getNodeBounds, isContainerNode, visibleFill } from "../types/figma";
import { apply, identity, invert, multiply, rotation, scaling, scaleOf, translation, type Mat } from "./matrix";

export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

export interface RenderOptions {
  viewport: Viewport;
  selectedId: string | null;
  hoverId: string | null;
  dpr: number;
}

function rgbaToCss(r: number, g: number, b: number, a: number): string {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v * 255)));
  return `rgba(${clamp(r)}, ${clamp(g)}, ${clamp(b)}, ${Math.max(0, Math.min(1, a))})`;
}

function nodeOpacity(node: FigmaNode): number {
  return node.opacity ?? 1;
}

function rotationDeg(deg: number | undefined): number {
  return ((deg ?? 0) * Math.PI) / 180;
}

export function localTransform(node: FigmaNode): Mat {
  const b = getNodeBounds(node);
  const cx = b.width / 2;
  const cy = b.height / 2;
  return multiply(translation(b.x, b.y), multiply(translation(cx, cy), rotation(rotationDeg(node.rotation))));
}

export function worldTransform(node: FigmaNode, parentWorld: Mat = identity()): Mat {
  return multiply(parentWorld, localTransform(node));
}

export function walkWithTransform(
  root: FigmaNode,
  fn: (node: FigmaNode, world: Mat) => boolean | void,
  parentWorld: Mat = identity(),
): boolean {
  const world = worldTransform(root, parentWorld);
  const stop = fn(root, world);
  if (stop === true) return true;
  if (isContainerNode(root)) {
    for (const child of root.children ?? []) {
      if (walkWithTransform(child, fn, world)) return true;
    }
  }
  return false;
}

export function getWorldTransformOf(root: FigmaNode, id: string): Mat | null {
  let result: Mat | null = null;
  walkWithTransform(root, (node, world) => {
    if (node.id === id) {
      result = world;
      return true;
    }
    return false;
  });
  return result;
}

export function setCanvasTransform(ctx: CanvasRenderingContext2D, m: Mat): void {
  ctx.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);
}

function setFillStyle(ctx: CanvasRenderingContext2D, paint: Paint | undefined, alpha: number): boolean {
  if (!paint || paint.visible === false) return false;

  switch (paint.type) {
    case "SOLID": {
      if (!paint.color) return false;
      ctx.fillStyle = rgbaToCss(paint.color.r, paint.color.g, paint.color.b, paint.color.a ?? 1);
      ctx.globalAlpha = alpha;
      return true;
    }
    case "GRADIENT_LINEAR": {
      const stops = paint.gradientStops ?? [];
      if (stops.length < 2 || !paint.gradientHandlePositions || paint.gradientHandlePositions.length < 2) return false;
      const [start, end] = paint.gradientHandlePositions;
      const gradient = ctx.createLinearGradient(start.x, start.y, end.x, end.y);
      for (const stop of stops) {
        gradient.addColorStop(
          Math.max(0, Math.min(1, stop.position)),
          rgbaToCss(stop.color.r, stop.color.g, stop.color.b, stop.color.a ?? 1),
        );
      }
      ctx.fillStyle = gradient;
      ctx.globalAlpha = alpha;
      return true;
    }
    default:
      return false;
  }
}

function drawFill(ctx: CanvasRenderingContext2D, paint: Paint, alpha: number): boolean {
  const ok = setFillStyle(ctx, paint, alpha);
  if (!ok) return false;
  ctx.fill();
  return true;
}

function drawStroke(ctx: CanvasRenderingContext2D, paint: Paint, alpha: number, weight: number): void {
  if (!paint || paint.visible === false || weight <= 0) return;
  if (paint.type !== "SOLID" || !paint.color) return;
  ctx.strokeStyle = rgbaToCss(paint.color.r, paint.color.g, paint.color.b, paint.color.a ?? 1);
  ctx.globalAlpha = alpha;
  ctx.lineWidth = weight;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.stroke();
}

function tracePath(ctx: CanvasRenderingContext2D, node: FigmaNode): void {
  const b = getNodeBounds(node);
  const { width, height } = b;
  switch (node.type) {
    case "ELLIPSE":
      ctx.beginPath();
      ctx.ellipse(width / 2, height / 2, width / 2, height / 2, 0, 0, Math.PI * 2);
      break;
    case "LINE":
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(width, height);
      break;
    case "RECTANGLE":
    case "FRAME":
    case "COMPONENT":
    case "COMPONENT_SET":
    case "INSTANCE":
    case "SECTION":
    case "BOOLEAN_OPERATION":
    case "VECTOR":
    case "SHAPE_WITH_TEXT":
    case "TABLE":
    case "TABLE_CELL": {
      const r = node.cornerRadius ?? 0;
      ctx.beginPath();
      if (r > 0) {
        ctx.roundRect(0, 0, width, height, Math.min(r, width / 2, height / 2));
      } else {
        ctx.rect(0, 0, width, height);
      }
      break;
    }
    case "POLYGON": {
      ctx.beginPath();
      const sides = 5;
      for (let i = 0; i < sides; i++) {
        const angle = (i / sides) * Math.PI * 2 - Math.PI / 2;
        const px = width / 2 + Math.cos(angle) * (width / 2);
        const py = height / 2 + Math.sin(angle) * (height / 2);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      break;
    }
    case "STAR": {
      ctx.beginPath();
      const points = 5;
      for (let i = 0; i < points * 2; i++) {
        const radius = i % 2 === 0 ? 0.5 : 0.5 * 0.382;
        const angle = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
        const px = width / 2 + Math.cos(angle) * radius * width;
        const py = height / 2 + Math.sin(angle) * radius * height;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      break;
    }
    default:
      ctx.beginPath();
      ctx.rect(0, 0, width, height);
  }
}

function applyEffects(ctx: CanvasRenderingContext2D, node: FigmaNode): () => void {
  const effects = node.effects ?? [];
  const shadow = effects.find((e) => e.type === "DROP_SHADOW" && e.visible !== false);
  const t = ctx.getTransform();
  const s = scaleOf([t.a, t.b, t.c, t.d, t.e, t.f]);
  if (shadow && shadow.color) {
    const { r, g, b, a } = shadow.color;
    ctx.shadowColor = rgbaToCss(r, g, b, a ?? 0.25);
    ctx.shadowBlur = (shadow.radius ?? 0) * s;
    ctx.shadowOffsetX = (shadow.offset?.x ?? 0) * s;
    ctx.shadowOffsetY = (shadow.offset?.y ?? 0) * s;
  }
  return () => {
    ctx.shadowColor = "transparent";
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
  };
}

function drawText(ctx: CanvasRenderingContext2D, node: FigmaNode, alpha: number): void {
  const characters = node.characters ?? "";
  if (!characters) return;
  const style = node.style ?? {};
  const fontFamily = style.fontFamily ?? "sans-serif";
  const fontSize = style.fontSize ?? 16;
  const fontWeight = style.fontWeight ?? 400;
  const italic = style.italic ? "italic " : "";
  const textCase = style.textCase;

  let text = characters;
  if (textCase === "UPPER") text = text.toUpperCase();
  else if (textCase === "LOWER") text = text.toLowerCase();

  ctx.font = `${italic}${fontWeight} ${fontSize}px ${fontFamily}`;

  const align = style.textAlignHorizontal ?? "LEFT";
  ctx.textAlign = align === "LEFT" ? "left" : align === "RIGHT" ? "right" : "center";
  ctx.textBaseline = "top";

  const b = getNodeBounds(node);
  const x = align === "LEFT" ? 0 : align === "RIGHT" ? b.width : b.width / 2;
  const y = 0;

  const fill = visibleFill(node) ?? { type: "SOLID", color: { r: 0, g: 0, b: 0 } };
  setFillStyle(ctx, fill, alpha);
  ctx.fillText(text, x, y, b.width);
}

function drawShapeBody(ctx: CanvasRenderingContext2D, node: FigmaNode, alpha: number): void {
  const fills = node.fills ?? [];
  const hasAnyFill = fills.some((f) => f.visible !== false);
  const strokes = node.strokes ?? [];
  const hasAnyStroke = strokes.some((f) => f.visible !== false) && (node.strokeWeight ?? 0) > 0;

  if (!hasAnyFill && !hasAnyStroke) {
    tracePath(ctx, node);
    return;
  }

  if (hasAnyFill) {
    tracePath(ctx, node);
    for (const paint of fills) {
      if (paint.type === "IMAGE") continue;
      if (drawFill(ctx, paint, alpha)) break;
    }
  }

  const strokePaint = strokes.find((s) => s.visible !== false);
  if (hasAnyStroke && strokePaint) {
    tracePath(ctx, node);
    drawStroke(ctx, strokePaint, alpha, node.strokeWeight ?? 1);
  }
}

function renderNode(
  ctx: CanvasRenderingContext2D,
  node: FigmaNode,
  parentWorld: Mat,
  opts: RenderOptions,
  depth: number,
): void {
  if (node.visible === false) return;
  const world = worldTransform(node, parentWorld);
  const alpha = nodeOpacity(node);
  const isContainer = isContainerNode(node);

  ctx.save();
  setCanvasTransform(ctx, world);

  if (isContainer) {
    const bodyFills = node.fills?.filter((f) => f.visible !== false) ?? [];
    const backgroundPaints = node.background ?? [];
    const paints = bodyFills.length > 0 ? bodyFills : backgroundPaints;

    if (paints.length > 0) {
      tracePath(ctx, node);
      for (const paint of paints) {
        if (paint.type === "IMAGE") continue;
        if (drawFill(ctx, paint, alpha)) break;
      }
    }

    if (node.clipContent) {
      tracePath(ctx, node);
      ctx.clip();
    }

    for (const child of node.children ?? []) {
      renderNode(ctx, child, world, opts, depth + 1);
    }
  } else {
    const clearShadow = applyEffects(ctx, node);
    if (node.type === "TEXT") {
      drawText(ctx, node, alpha);
    } else {
      drawShapeBody(ctx, node, alpha);
    }
    clearShadow();
  }

  ctx.restore();

  if (opts.selectedId === node.id || opts.hoverId === node.id) {
    drawSelection(ctx, world, getNodeBounds(node), opts.selectedId === node.id);
  }
}

function drawSelection(ctx: CanvasRenderingContext2D, world: Mat, b: { x: number; y: number; width: number; height: number }, selected: boolean): void {
  const zoom = scaleOf(world);
  ctx.save();
  setCanvasTransform(ctx, world);
  ctx.globalAlpha = 1;
  ctx.beginPath();
  ctx.rect(0, 0, b.width, b.height);
  ctx.strokeStyle = selected ? "#0d99ff" : "#0d99ff";
  ctx.lineWidth = selected ? 2 : 1;
  ctx.setLineDash(selected ? [] : [4, 4]);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();

  if (selected) {
    const s = zoom;
    const corners = [
      [0, 0],
      [b.width, 0],
      [b.width, b.height],
      [0, b.height],
    ];
    const size = Math.max(6, 5 / s);
    ctx.save();
    for (const [cx, cy] of corners) {
      const [wx, wy] = apply(world, cx, cy);
      ctx.fillStyle = "#0d99ff";
      ctx.fillRect(wx - size / 2, wy - size / 2, size, size);
    }
    ctx.restore();
  }
}

export function renderScene(
  ctx: CanvasRenderingContext2D,
  page: FigmaNode | null,
  canvasWidth: number,
  canvasHeight: number,
  opts: RenderOptions,
): void {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvasWidth, canvasHeight);

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);

  if (!page) return;

  const base = multiply(
    translation(opts.viewport.x * opts.dpr, opts.viewport.y * opts.dpr),
    scaling(opts.viewport.zoom * opts.dpr, opts.viewport.zoom * opts.dpr),
  );

  ctx.save();
  setCanvasTransform(ctx, base);

  for (const child of page.children ?? []) {
    renderNode(ctx, child, identity(), opts, 0);
  }

  ctx.restore();
}

export function hitTestNodeAt(page: FigmaNode, x: number, y: number, viewport: Viewport): string | null {
  const base = multiply(translation(viewport.x, viewport.y), scaling(viewport.zoom, viewport.zoom));
  const hits: string[] = [];

  walkWithTransform(page, (node, world) => {
    if (!node.id) return false;
    const m = invert(multiply(base, world));
    const [lx, ly] = apply(m, x, y);
    const b = getNodeBounds(node);
    let inside = false;
    if (node.type === "ELLIPSE") {
      const nx = (lx - b.width / 2) / Math.max(b.width / 2, 0.001);
      const ny = (ly - b.height / 2) / Math.max(b.height / 2, 0.001);
      inside = nx * nx + ny * ny <= 1;
    } else if (node.type === "LINE") {
      inside = lx >= 0 && lx <= b.width && Math.abs(ly) <= 8;
    } else {
      inside = lx >= -8 && lx <= b.width + 8 && ly >= -8 && ly <= b.height + 8;
    }
    if (inside) hits.push(node.id);
    return false;
  });

  return hits.length > 0 ? hits[hits.length - 1] : null;
}
