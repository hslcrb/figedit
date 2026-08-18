import type { CodeComponentBinding, DesignToken, LabelMedia, LabelPath, MediaAsset, PrototypeInteraction } from "./design";

export interface Vec2 {
  x: number;
  y: number;
}

export interface RGBA {
  r: number;
  g: number;
  b: number;
  a?: number;
}

export type PaintType =
  | "SOLID"
  | "GRADIENT_LINEAR"
  | "GRADIENT_RADIAL"
  | "GRADIENT_ANGULAR"
  | "GRADIENT_DIAMOND"
  | "IMAGE"
  | "EMOJI";

export interface GradientStop {
  color: RGBA;
  position: number;
}

export interface Paint {
  type: PaintType;
  color?: RGBA;
  opacity?: number;
  visible?: boolean;
  gradientHandlePositions?: Vec2[];
  gradientStops?: GradientStop[];
  imageRef?: string;
  scaleMode?: "FILL" | "FIT" | "TILE" | "CROP" | "STRETCH";
}

export type BlendMode =
  | "PASS_THROUGH"
  | "NORMAL"
  | "DARKEN"
  | "MULTIPLY"
  | "COLOR_BURN"
  | "SCREEN"
  | "OVERLAY"
  | "HARD_LIGHT"
  | "SOFT_LIGHT"
  | "COLOR_DODGE"
  | "LINEAR_DODGE"
  | "COLOR"
  | "LUMINOSITY";

export interface Effect {
  type: string;
  visible?: boolean;
  color?: RGBA;
  offset?: Vec2;
  radius?: number;
  spread?: number;
  blendMode?: BlendMode;
  showShadowBehindNode?: boolean;
}

export interface TextStyle {
  fontFamily?: string;
  fontPostScriptName?: string;
  fontWeight?: number;
  fontSize?: number;
  textAlignHorizontal?: "LEFT" | "CENTER" | "RIGHT" | "JUSTIFIED";
  textAlignVertical?: "TOP" | "CENTER" | "BOTTOM";
  letterSpacing?: number;
  lineHeightPx?: number;
  lineHeightPercent?: number;
  textCase?: "UPPER" | "LOWER" | "TITLE" | "ORIGINAL";
  textDecoration?: "NONE" | "UNDERLINE" | "STRIKETHROUGH";
  italic?: boolean;
  fill?: Paint[];
  textStyleId?: string;
}

export type LayoutMode = "NONE" | "HORIZONTAL" | "VERTICAL";
export type LayoutAlign = "INHERIT" | "STRETCH" | "MIN";
export type StrokeAlign = "INSIDE" | "OUTSIDE" | "CENTER";

export interface Constraints {
  horizontal?: "MIN" | "CENTER" | "MAX" | "STRETCH" | "SCALE";
  vertical?: "MIN" | "CENTER" | "MAX" | "STRETCH" | "SCALE";
}

export interface FigmaNode {
  type: string;
  id?: string;
  name?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  rotation?: number;
  visible?: boolean;
  opacity?: number;
  fills?: Paint[];
  strokes?: Paint[];
  strokeWeight?: number;
  strokeAlign?: StrokeAlign;
  strokeCap?: string;
  strokeJoin?: string;
  strokeMiterAngle?: number;
  strokeGeometry?: unknown[];
  effects?: Effect[];
  blendMode?: BlendMode;
  clipContent?: boolean;
  cornerRadius?: number;
  cornerSmoothing?: number;
  rectangleCornerRadii?: [number, number, number, number];
  constraints?: Constraints;
  layoutMode?: LayoutMode;
  layoutAlign?: LayoutAlign;
  itemSpacing?: number;
  counterAxisSpacing?: number;
  primaryAxisAlignItems?: string;
  counterAxisAlignItems?: string;
  paddingLeft?: number;
  paddingRight?: number;
  paddingTop?: number;
  paddingBottom?: number;
  background?: Paint[];
  backgroundColor?: RGBA;
  fillGeometry?: unknown[];
  characters?: string;
  style?: TextStyle;
  textAutoResize?: "NONE" | "HEIGHT" | "WIDTH_AND_HEIGHT";
  preserveRatio?: boolean;
  exportSettings?: unknown[];
  labelFillTokenId?: string;
  labelComponentId?: string;
  labelComponentName?: string;
  labelImportPath?: string;
  labelSemantic?: "auto" | "button" | "link" | "heading" | "list" | "image" | "decorative";
  labelAccessibleName?: string;
  labelPrototype?: PrototypeInteraction;
  labelPath?: LabelPath;
  labelMedia?: LabelMedia;
  layoutSizingHorizontal?: "FIXED" | "HUG" | "FILL";
  layoutSizingVertical?: "FIXED" | "HUG" | "FILL";
  studioGlass?: {
    enabled: boolean;
    blur: number;
  };
  children?: FigmaNode[];
  [key: string]: unknown;
}

export interface FigmaDocument {
  name: string;
  version?: string;
  lastModified?: string;
  thumbnailUrl?: string | null;
  schemaVersion?: number;
  document: FigmaNode;
  labelTokens?: DesignToken[];
  labelAssets?: Record<string, MediaAsset>;
  labelCodeComponents?: CodeComponentBinding[];
  labelPrototype?: PrototypeInteraction[];
  [key: string]: unknown;
}

export const NODE_TYPES = [
  "DOCUMENT",
  "PAGE",
  "FRAME",
  "GROUP",
  "SECTION",
  "COMPONENT_SET",
  "COMPONENT",
  "INSTANCE",
  "RECTANGLE",
  "ELLIPSE",
  "LINE",
  "POLYGON",
  "STAR",
  "VECTOR",
  "BOOLEAN_OPERATION",
  "TEXT",
  "SLICE",
  "STICKY",
  "CONNECTOR",
  "SHAPE_WITH_TEXT",
  "CODE_BLOCK",
  "EMBED",
  "LINK_PREVIEW",
  "MEDIA",
  "WASHI_TAPE",
  "TABLE",
  "TABLE_CELL",
] as const;

export type FigmaNodeType = (typeof NODE_TYPES)[number];

export type DesignTool = "SELECT" | "FRAME" | "RECTANGLE" | "ELLIPSE" | "TEXT" | "PEN";

export function isContainerNode(node: FigmaNode): boolean {
  return Array.isArray(node.children);
}

export function isPageNode(node: FigmaNode): boolean {
  return node.type === "PAGE";
}

export function isLeafNode(node: FigmaNode): boolean {
  return !Array.isArray(node.children);
}

export function getNodeBounds(node: FigmaNode): { x: number; y: number; width: number; height: number } {
  return {
    x: node.x ?? 0,
    y: node.y ?? 0,
    width: node.width ?? 0,
    height: node.height ?? 0,
  };
}

export function hasFill(node: FigmaNode): boolean {
  return Array.isArray(node.fills) && node.fills.some((f) => f.type !== "IMAGE");
}

export function visibleFill(node: FigmaNode): Paint | undefined {
  if (!Array.isArray(node.fills)) return undefined;
  return node.fills.find((f) => f.visible !== false && f.type !== "IMAGE");
}
