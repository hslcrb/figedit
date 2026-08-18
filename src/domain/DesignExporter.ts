import type { FigmaDocument, FigmaNode, Paint } from "../types/figma";
import { getNodeBounds, isContainerNode, visibleFill } from "../types/figma";
import { findNode, firstPage } from "../lib/figma";
import { pathToSvg } from "../lib/path";

function escapeXml(value: string): string {
  return value.replace(/[<>&'"]/g, (character) => {
    const entities: Record<string, string> = {
      "<": "&lt;",
      ">": "&gt;",
      "&": "&amp;",
      "'": "&apos;",
      '"': "&quot;",
    };
    return entities[character];
  });
}

function paintColor(paint: Paint | undefined): string {
  if (!paint?.color) return "#FFFFFF";
  const channel = (value: number) => Math.round(Math.max(0, Math.min(1, value)) * 255);
  return `rgb(${channel(paint.color.r)} ${channel(paint.color.g)} ${channel(paint.color.b)})`;
}

function paintOpacity(paint: Paint | undefined): number {
  return Math.max(0, Math.min(1, paint?.opacity ?? 1));
}

function nodeTransform(node: FigmaNode): string {
  const x = node.x ?? 0;
  const y = node.y ?? 0;
  const rotation = node.rotation ?? 0;
  const bounds = getNodeBounds(node);
  return `translate(${x} ${y}) rotate(${rotation} ${bounds.width / 2} ${bounds.height / 2})`;
}

function shapeMarkup(node: FigmaNode, paint: Paint | undefined): string {
  const bounds = getNodeBounds(node);
  const radius = Math.max(0, node.cornerRadius ?? 0);
  const fill = paintColor(paint);
  const opacity = paintOpacity(paint);
  const attributes = `fill="${fill}" fill-opacity="${opacity}"`;

  const imagePaint = node.fills?.find((paintItem) => paintItem.type === "IMAGE");
  if (imagePaint?.imageRef) return `<image href="${escapeXml(`./assets/${imagePaint.imageRef.split("/").pop() ?? imagePaint.imageRef}`)}" width="${bounds.width}" height="${bounds.height}" preserveAspectRatio="xMidYMid slice" opacity="${opacity}" />`;
  if (node.type === "VECTOR" && node.labelPath) {
    const stroke = node.strokes?.find((paintItem) => paintItem.visible !== false);
    return `<path d="${pathToSvg(node.labelPath)}" fill-rule="${node.labelPath.fillRule.toLowerCase()}" fill="${node.labelPath.closed ? fill : "none"}" fill-opacity="${opacity}" stroke="${paintColor(stroke)}" stroke-opacity="${paintOpacity(stroke)}" stroke-width="${node.strokeWeight ?? 1}" />`;
  }

  switch (node.type) {
    case "ELLIPSE":
      return `<ellipse cx="${bounds.width / 2}" cy="${bounds.height / 2}" rx="${bounds.width / 2}" ry="${bounds.height / 2}" ${attributes} />`;
    case "LINE": {
      const stroke = node.strokes?.find((paintItem) => paintItem.visible !== false);
      return `<line x1="0" y1="0" x2="${bounds.width}" y2="${bounds.height}" stroke="${paintColor(stroke)}" stroke-opacity="${paintOpacity(stroke)}" stroke-width="${node.strokeWeight ?? 1}" />`;
    }
    default:
      return `<rect width="${bounds.width}" height="${bounds.height}" rx="${radius}" ${attributes} />`;
  }
}

function nodeMarkup(node: FigmaNode): string {
  if (node.visible === false) return "";
  const transform = nodeTransform(node);
  const opacity = node.opacity ?? 1;

  if (node.type === "TEXT") {
    const bounds = getNodeBounds(node);
    const style = node.style ?? {};
    const fill = visibleFill(node);
    const anchor = style.textAlignHorizontal === "CENTER" ? "middle" : style.textAlignHorizontal === "RIGHT" ? "end" : "start";
    const x = anchor === "middle" ? bounds.width / 2 : anchor === "end" ? bounds.width : 0;
    return `<g transform="${transform}" opacity="${opacity}"><text x="${x}" y="${style.fontSize ?? 16}" text-anchor="${anchor}" fill="${paintColor(fill)}" fill-opacity="${paintOpacity(fill)}" font-family="${escapeXml(style.fontFamily ?? "sans-serif")}" font-size="${style.fontSize ?? 16}" font-weight="${style.fontWeight ?? 400}">${escapeXml(node.characters ?? "")}</text></g>`;
  }

  const fill = visibleFill(node);
  const body = nodeMarkupShape(node, fill);
  const children = isContainerNode(node) ? (node.children ?? []).map(nodeMarkup).join("") : "";
  return `<g transform="${transform}" opacity="${opacity}">${body}${children}</g>`;
}

function nodeMarkupShape(node: FigmaNode, paint: Paint | undefined): string {
  if (node.type === "PAGE" || node.type === "DOCUMENT") return "";
  if (node.type !== "LINE" && node.type !== "VECTOR" && !paint && !node.fills?.some((paintItem) => paintItem.type === "IMAGE")) return "";
  return shapeMarkup(node, paint);
}

function documentBounds(root: FigmaNode): { x: number; y: number; width: number; height: number } {
  if (root.type !== "PAGE" && root.type !== "DOCUMENT") {
    const bounds = getNodeBounds(root);
    return { x: bounds.x, y: bounds.y, width: Math.max(bounds.width, 1), height: Math.max(bounds.height, 1) };
  }
  const children = root.type === "PAGE" ? root.children ?? [] : [root];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const child of children) {
    const bounds = getNodeBounds(child);
    minX = Math.min(minX, bounds.x);
    minY = Math.min(minY, bounds.y);
    maxX = Math.max(maxX, bounds.x + bounds.width);
    maxY = Math.max(maxY, bounds.y + bounds.height);
  }
  if (minX === Infinity) return { x: 0, y: 0, width: 960, height: 640 };
  return { x: minX, y: minY, width: Math.max(maxX - minX, 1), height: Math.max(maxY - minY, 1) };
}

export class DesignExporter {
  private readonly document: FigmaDocument;
  private readonly root: FigmaNode;

  public constructor(document: FigmaDocument, rootId?: string | null) {
    this.document = document;
    this.root = (rootId ? findNode(document.document, rootId) : firstPage(document.document)) ?? document.document;
  }

  public toJson(): string {
    return JSON.stringify(this.document, null, 2);
  }

  public toSvg(): string {
    const bounds = documentBounds(this.root);
    const body = this.root.type === "PAGE" ? (this.root.children ?? []).map(nodeMarkup).join("") : nodeMarkup(this.root);
    return [
      `<svg xmlns="http://www.w3.org/2000/svg" width="${bounds.width}" height="${bounds.height}" viewBox="${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}">`,
      `<title>${escapeXml(this.document.name || "LabelStudio design")}</title>`,
      body,
      "</svg>",
    ].join("");
  }
}

export function downloadText(content: string, filename: string, type = "text/plain"): void {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function downloadCanvasPng(filename: string): void {
  const canvas = document.querySelector<HTMLCanvasElement>("canvas[data-editor-canvas], canvas[data-preview-canvas]");
  if (!canvas) return;
  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }, "image/png");
}
