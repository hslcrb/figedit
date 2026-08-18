export type DesignTokenType = "COLOR" | "NUMBER" | "STRING";

export type WorkspaceMode = "DESIGN" | "MEDIA" | "CODE";

export interface PathPoint {
  x: number;
  y: number;
  handleIn?: { x: number; y: number };
  handleOut?: { x: number; y: number };
}

export interface LabelPath {
  version: 1;
  fillRule: "NONZERO" | "EVENODD";
  closed: boolean;
  points: PathPoint[];
  subpaths?: PathPoint[][];
}

export interface MediaAdjustments {
  brightness: number;
  contrast: number;
  saturation: number;
  grayscale: number;
  blur: number;
}

export interface MediaCrop {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface MediaAsset {
  id: string;
  path: string;
  originalName: string;
  mimeType: string;
  width: number;
  height: number;
  byteLength: number;
}

export interface LabelMedia {
  assetId: string;
  crop: MediaCrop;
  adjustments: MediaAdjustments;
  alt?: string;
}

export const DEFAULT_MEDIA_ADJUSTMENTS: MediaAdjustments = {
  brightness: 0,
  contrast: 0,
  saturation: 0,
  grayscale: 0,
  blur: 0,
};

export const FULL_MEDIA_CROP: MediaCrop = { x: 0, y: 0, width: 1, height: 1 };

export type DesignTokenValue = string | number;

export interface DesignToken {
  id: string;
  name: string;
  type: DesignTokenType;
  value: DesignTokenValue;
  description?: string;
}

export interface CodeComponentBinding {
  nodeId: string;
  componentName: string;
  importPath: string;
  framework: "REACT" | "HTML";
  propMap?: Record<string, string>;
}

export type PrototypeAction = "NAVIGATE" | "BACK";

export interface PrototypeInteraction {
  nodeId: string;
  action: PrototypeAction;
  destinationId?: string;
}

export type HandoffIssueSeverity = "BLOCKER" | "WARNING" | "INFO";

export interface HandoffIssue {
  severity: HandoffIssueSeverity;
  nodeId?: string;
  title: string;
  detail: string;
}

export interface HandoffReport {
  generatedAt: string;
  documentName: string;
  nodeCount: number;
  issues: HandoffIssue[];
}

export const DEFAULT_DESIGN_TOKENS: DesignToken[] = [
  { id: "color-ink", name: "color.ink", type: "COLOR", value: "#111111", description: "Primary text and controls" },
  { id: "color-charcoal", name: "color.charcoal", type: "COLOR", value: "#292929", description: "Surface and frame" },
  { id: "color-lime", name: "color.lime", type: "COLOR", value: "#D9FF4A", description: "Action and focus" },
  { id: "color-yellow", name: "color.lightYellow", type: "COLOR", value: "#FFF4A3", description: "Soft highlight" },
  { id: "color-white", name: "color.white", type: "COLOR", value: "#FFFFFF", description: "Primary light surface" },
  { id: "space-4", name: "space.4", type: "NUMBER", value: 4, description: "Micro spacing" },
  { id: "space-8", name: "space.8", type: "NUMBER", value: 8, description: "Compact spacing" },
  { id: "space-16", name: "space.16", type: "NUMBER", value: 16, description: "Default spacing" },
  { id: "radius-12", name: "radius.12", type: "NUMBER", value: 12, description: "Soft corner" },
];

export function tokenValue(tokens: DesignToken[], id: string | undefined): DesignTokenValue | undefined {
  if (!id) return undefined;
  return tokens.find((token) => token.id === id)?.value;
}

export function cssTokenName(token: DesignToken): string {
  return `--ls-${token.name.replace(/[^a-zA-Z0-9]+/g, "-").toLowerCase()}`;
}
