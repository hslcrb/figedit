import type { FigmaNode, Paint } from "../types/figma";
import { getNodeBounds, isContainerNode, visibleFill } from "../types/figma";
import { apply, identity, invert, multiply, rotation, scaling, scaleOf, translation, type Mat } from "./matrix";
import { traceLabelPath } from "./path";

export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

export interface RenderOptions {
  viewport: Viewport;
  selectedId: string | null;
  selectedIds?: string[];
  dpr: number;
  hoverId?: string | null;
  assets?: Record<string, Uint8Array>;
  onAssetLoad?: () => void;
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
  return multiply(translation(b.x, b.y), multiply(translation(cx, cy), multiply(rotation(rotationDeg(node.rotation)), translation(-cx, -cy))));
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
      ctx.globalAlpha = alpha * (paint.opacity ?? 1);
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
      ctx.globalAlpha = alpha * (paint.opacity ?? 1);
      return true;
    }
    default:
      return false;
  }
}

function drawFill(ctx: CanvasRenderingContext2D, paint: Paint, alpha: number, fillRule: CanvasFillRule = "nonzero"): boolean {
  const ok = setFillStyle(ctx, paint, alpha);
  if (!ok) return false;
  ctx.fill(fillRule);
  return true;
}

function drawStroke(ctx: CanvasRenderingContext2D, paint: Paint, alpha: number, weight: number): void {
  if (!paint || paint.visible === false || weight <= 0) return;
  if (paint.type !== "SOLID" || !paint.color) return;
  ctx.strokeStyle = rgbaToCss(paint.color.r, paint.color.g, paint.color.b, paint.color.a ?? 1);
  ctx.globalAlpha = alpha * (paint.opacity ?? 1);
  ctx.lineWidth = weight;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.stroke();
}

interface ImageCacheEntry {
  state: "loading" | "ready" | "error";
  image?: HTMLImageElement;
}

const imageCache = new Map<string, ImageCacheEntry>();

function imageFor(paint: Paint, opts: RenderOptions): HTMLImageElement | null {
  const path = paint.imageRef;
  const bytes = path ? opts.assets?.[path] : undefined;
  if (!path || !bytes) return null;
  const cached = imageCache.get(path);
  if (cached?.state === "ready") return cached.image ?? null;
  if (cached?.state === "loading") return null;
  const image = new Image();
  imageCache.set(path, { state: "loading" });
  const url = URL.createObjectURL(new Blob([bytes as BlobPart]));
  image.onload = () => {
    URL.revokeObjectURL(url);
    imageCache.set(path, { state: "ready", image });
    opts.onAssetLoad?.();
  };
  image.onerror = () => {
    URL.revokeObjectURL(url);
    imageCache.set(path, { state: "error" });
    opts.onAssetLoad?.();
  };
  image.src = url;
  return null;
}

function drawImagePaint(ctx: CanvasRenderingContext2D, node: FigmaNode, paint: Paint, alpha: number, opts: RenderOptions): boolean {
  const image = imageFor(paint, opts);
  const bounds = getNodeBounds(node);
  if (!image) {
    ctx.fillStyle = "#242424";
    ctx.globalAlpha = alpha * (paint.opacity ?? 1);
    ctx.fill();
    return true;
  }
  const media = node.labelMedia;
  const crop = media?.crop ?? { x: 0, y: 0, width: 1, height: 1 };
  let sourceX = image.naturalWidth * crop.x;
  let sourceY = image.naturalHeight * crop.y;
  let sourceWidth = image.naturalWidth * crop.width;
  let sourceHeight = image.naturalHeight * crop.height;
  const scaleMode = paint.scaleMode ?? "CROP";
  if (scaleMode === "CROP" && bounds.width > 0 && bounds.height > 0) {
    const targetRatio = bounds.width / bounds.height;
    const sourceRatio = sourceWidth / Math.max(sourceHeight, 1);
    if (sourceRatio > targetRatio) {
      const nextWidth = sourceHeight * targetRatio;
      sourceX += (sourceWidth - nextWidth) / 2;
      sourceWidth = nextWidth;
    } else {
      const nextHeight = sourceWidth / targetRatio;
      sourceY += (sourceHeight - nextHeight) / 2;
      sourceHeight = nextHeight;
    }
  }
  let destinationX = 0;
  let destinationY = 0;
  let destinationWidth = bounds.width;
  let destinationHeight = bounds.height;
  if (scaleMode === "FIT") {
    const ratio = Math.min(bounds.width / Math.max(sourceWidth, 1), bounds.height / Math.max(sourceHeight, 1));
    destinationWidth = sourceWidth * ratio;
    destinationHeight = sourceHeight * ratio;
    destinationX = (bounds.width - destinationWidth) / 2;
    destinationY = (bounds.height - destinationHeight) / 2;
  }
  tracePath(ctx, node);
  ctx.save();
  ctx.clip();
  const adjustment = media?.adjustments;
  ctx.filter = adjustment ? `brightness(${1 + adjustment.brightness}) contrast(${1 + adjustment.contrast}) saturate(${1 + adjustment.saturation}) grayscale(${adjustment.grayscale}) blur(${Math.max(0, adjustment.blur)}px)` : "none";
  ctx.globalAlpha = alpha * (paint.opacity ?? 1);
  ctx.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, destinationX, destinationY, destinationWidth, destinationHeight);
  ctx.restore();
  return true;
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
    case "VECTOR":
      if (node.labelPath) {
        traceLabelPath(ctx, node.labelPath);
        break;
      }
      ctx.beginPath();
      ctx.rect(0, 0, width, height);
      break;
    case "RECTANGLE":
    case "FRAME":
    case "COMPONENT":
    case "COMPONENT_SET":
    case "INSTANCE":
    case "SECTION":
    case "BOOLEAN_OPERATION":
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

function drawShapeBody(ctx: CanvasRenderingContext2D, node: FigmaNode, alpha: number, opts: RenderOptions): void {
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
      if (paint.type === "IMAGE") {
        if (drawImagePaint(ctx, node, paint, alpha, opts)) break;
        continue;
      }
      if (drawFill(ctx, paint, alpha, node.labelPath?.fillRule === "EVENODD" ? "evenodd" : "nonzero")) break;
    }
  }

  const strokePaint = strokes.find((s) => s.visible !== false);
  if (hasAnyStroke && strokePaint) {
    tracePath(ctx, node);
    drawStroke(ctx, strokePaint, alpha, node.strokeWeight ?? 1);
  }
}

function drawGlassSurface(ctx: CanvasRenderingContext2D, node: FigmaNode, alpha: number): void {
  if (!node.studioGlass?.enabled) return;
  tracePath(ctx, node);
  ctx.save();
  ctx.globalAlpha = Math.min(0.22, alpha * 0.22);
  ctx.fillStyle = "rgba(255, 255, 255, 1)";
  ctx.fill();
  ctx.restore();
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
        if (paint.type === "IMAGE") {
          if (drawImagePaint(ctx, node, paint, alpha, opts)) break;
          continue;
        }
        if (drawFill(ctx, paint, alpha)) break;
      }
    }

    drawGlassSurface(ctx, node, alpha);

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
      drawShapeBody(ctx, node, alpha, opts);
    }
    drawGlassSurface(ctx, node, alpha);
    clearShadow();
  }

  ctx.restore();

  const selected = Boolean(node.id && (opts.selectedIds?.includes(node.id) || opts.selectedId === node.id));
  if (selected) {
    drawSelection(ctx, world, getNodeBounds(node), true);
  }
}

function drawSelection(ctx: CanvasRenderingContext2D, world: Mat, b: { x: number; y: number; width: number; height: number }, selected: boolean): void {
  const zoom = scaleOf(world);
  ctx.save();
  setCanvasTransform(ctx, world);
  ctx.globalAlpha = 1;
  ctx.beginPath();
  ctx.rect(0, 0, b.width, b.height);
  ctx.fillStyle = selected ? "rgba(217, 255, 74, 0.13)" : "transparent";
  ctx.fill();
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
      ctx.fillStyle = "#D9FF4A";
      ctx.beginPath();
      ctx.roundRect(wx - size / 2, wy - size / 2, size, size, Math.min(2, size / 3));
      ctx.fill();
    }
    ctx.restore();
  }
}

function drawCanvasBackdrop(ctx: CanvasRenderingContext2D, width: number, height: number, dpr: number): void {
  ctx.fillStyle = "#111111";
  ctx.fillRect(0, 0, width, height);

  const spacing = Math.max(18, Math.round(24 * dpr));
  ctx.fillStyle = "rgba(255, 255, 255, 0.12)";
  for (let x = spacing; x < width; x += spacing) {
    for (let y = spacing; y < height; y += spacing) {
      ctx.fillRect(x, y, Math.max(1, dpr), Math.max(1, dpr));
    }
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

  drawCanvasBackdrop(ctx, canvasWidth, canvasHeight, opts.dpr);

  if (!page) return;

  const base = multiply(
    translation(opts.viewport.x * opts.dpr, opts.viewport.y * opts.dpr),
    scaling(opts.viewport.zoom * opts.dpr, opts.viewport.zoom * opts.dpr),
  );

  ctx.save();
  setCanvasTransform(ctx, base);

  for (const child of page.children ?? []) {
    renderNode(ctx, child, base, opts, 0);
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

export function selectNodesInRect(page: FigmaNode, x: number, y: number, width: number, height: number, viewport: Viewport): string[] {
  const base = multiply(translation(viewport.x, viewport.y), scaling(viewport.zoom, viewport.zoom));
  const left = Math.min(x, x + width);
  const right = Math.max(x, x + width);
  const top = Math.min(y, y + height);
  const bottom = Math.max(y, y + height);
  const selected: string[] = [];
  walkWithTransform(page, (node, world) => {
    if (!node.id || node.type === "PAGE") return false;
    const screen = multiply(base, world);
    const bounds = getNodeBounds(node);
    const corners = [
      apply(screen, 0, 0),
      apply(screen, bounds.width, 0),
      apply(screen, bounds.width, bounds.height),
      apply(screen, 0, bounds.height),
    ];
    const nodeLeft = Math.min(...corners.map(([px]) => px));
    const nodeRight = Math.max(...corners.map(([px]) => px));
    const nodeTop = Math.min(...corners.map(([, py]) => py));
    const nodeBottom = Math.max(...corners.map(([, py]) => py));
    if (nodeLeft >= left && nodeRight <= right && nodeTop >= top && nodeBottom <= bottom) {
      selected.push(node.id);
    }
    return false;
  });
  const selectedSet = new Set(selected);
  const filtered: string[] = [];
  const removeNested = (node: FigmaNode, ancestorSelected: boolean) => {
    const isSelected = Boolean(node.id && selectedSet.has(node.id));
    if (isSelected && !ancestorSelected) filtered.push(node.id!);
    for (const child of node.children ?? []) removeNested(child, ancestorSelected || isSelected);
  };
  removeNested(page, false);
  return filtered;
}
