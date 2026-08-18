import { strToU8, zipSync } from "fflate";
import type { FigmaDocument, FigmaNode, Paint } from "../types/figma";
import { countNodes, findNode, firstPage, walk } from "../lib/figma";
import { isContainerNode, visibleFill } from "../types/figma";
import type { DesignToken, HandoffIssue, HandoffReport } from "../types/design";
import { cssTokenName } from "../types/design";
import { pathToSvg } from "../lib/path";

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character);
}

function safeName(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase() || "node";
}

function componentIdentifier(value: string | undefined): string {
  const normalized = (value ?? "").replace(/[^a-zA-Z0-9_$]/g, "");
  if (!normalized) return "LabelStudioComponent";
  return /^[0-9]/.test(normalized) ? `LS${normalized}` : normalized;
}

function cssColor(paint: Paint | undefined): string {
  if (!paint?.color) return "#FFFFFF";
  const channel = (value: number) => Math.round(Math.max(0, Math.min(1, value)) * 255);
  const alpha = paint.opacity ?? paint.color.a ?? 1;
  return `rgba(${channel(paint.color.r)}, ${channel(paint.color.g)}, ${channel(paint.color.b)}, ${Math.max(0, Math.min(1, alpha))})`;
}

function tokenFor(node: FigmaNode, tokens: DesignToken[]): DesignToken | undefined {
  return tokens.find((token) => token.id === node.labelFillTokenId);
}

function paintValue(node: FigmaNode, tokens: DesignToken[]): { value: string; token?: string } {
  const token = tokenFor(node, tokens);
  if (token) return { value: cssTokenName(token), token: cssTokenName(token) };
  return { value: cssColor(visibleFill(node)) };
}

function nodeClass(node: FigmaNode): string {
  return `ls-node ls-${safeName(node.id ?? node.name ?? node.type)}`;
}

function semanticTag(node: FigmaNode, react = false): string {
  const semantic = typeof node.labelSemantic === "string" ? node.labelSemantic : "";
  if (semantic === "button") return "button";
  if (semantic === "link") return "a";
  if (semantic === "heading") return "h2";
  if (semantic === "list") return "ul";
  if (node.type === "TEXT") return "p";
  if (node.type === "FRAME" || node.type === "SECTION" || node.type === "COMPONENT") return react ? "section" : "section";
  return "div";
}

function nodeStyle(node: FigmaNode, tokens: DesignToken[]): string {
  const bounds = { width: node.width ?? 0, height: node.height ?? 0 };
  const fill = paintValue(node, tokens);
  const paint = visibleFill(node);
  const styles = [`width:${Math.max(0, bounds.width)}px`, `height:${Math.max(0, bounds.height)}px`, `opacity:${node.opacity ?? 1}`];
  if (node.type !== "TEXT" && node.type !== "LINE" && paint) styles.push(`background:${fill.value}`);
  if (node.studioGlass?.enabled) styles.push(`backdrop-filter:blur(${Math.max(0, node.studioGlass.blur)}px)`, "background:rgba(255,255,255,.18)");
  if (node.cornerRadius) styles.push(`border-radius:${node.cornerRadius}px`);
  if (node.rotation) styles.push(`transform:rotate(${node.rotation}deg)`);
  if (node.type === "TEXT") {
    const style = node.style ?? {};
    styles.push(`color:${paint ? fill.value : "#111111"}`, `font-family:${JSON.stringify(style.fontFamily ?? "Arial, sans-serif")}`, `font-size:${style.fontSize ?? 16}px`, `font-weight:${style.fontWeight ?? 400}`, `line-height:${style.lineHeightPx ?? Math.round((style.fontSize ?? 16) * 1.4)}px`);
    if (style.textAlignHorizontal) styles.push(`text-align:${style.textAlignHorizontal.toLowerCase()}`);
  }
  return styles.join(";");
}

function nodeMarkup(node: FigmaNode, tokens: DesignToken[], react = false, parentLayout = "NONE"): string {
  if (node.visible === false) return "";
  if (node.type === "PAGE" || node.type === "DOCUMENT") return (node.children ?? []).map((child) => nodeMarkup(child, tokens, react, "NONE")).join("");
  const tag = semanticTag(node, react);
  const className = nodeClass(node);
  const attrs = react
    ? `className="${className}" data-label-id="${escapeHtml(node.id ?? "")}"`
    : `class="${className}" data-label-id="${escapeHtml(node.id ?? "")}"`;
  const style = nodeStyle(node, tokens);
  const styleAttr = react ? ` style={{ ${style.split(";").filter(Boolean).map((item) => {
    const [key, value] = item.split(":");
    return `${key.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase())}: ${JSON.stringify(value)}`;
  }).join(", ")} }` : "";
  const accessibleName = typeof node.labelAccessibleName === "string" ? node.labelAccessibleName : node.name;
  const aria = accessibleName && tag !== "p" ? (react ? ` aria-label="${escapeHtml(accessibleName)}"` : ` aria-label="${escapeHtml(accessibleName)}"`) : "";
  const children = isContainerNode(node) ? (node.children ?? []).map((child) => nodeMarkup(child, tokens, react, node.layoutMode ?? "NONE")).join("") : "";
  if (node.type === "VECTOR" && node.labelPath) {
    const fill = paintValue(node, tokens).value;
    const svgAttrs = react ? `className="${className}" data-label-id="${escapeHtml(node.id ?? "")}"` : `class="${className}" data-label-id="${escapeHtml(node.id ?? "")}"`;
    const fillRule = react ? "fillRule" : "fill-rule";
    return `<svg ${svgAttrs} viewBox="0 0 ${node.width ?? 0} ${node.height ?? 0}" preserveAspectRatio="none"><path d="${pathToSvg(node.labelPath)}" fill="${fill}" ${fillRule}="${node.labelPath.fillRule.toLowerCase()}" /></svg>`;
  }
  if (react && node.labelComponentName && node.labelImportPath) {
    const component = componentIdentifier(node.labelComponentName);
    return `<${component} ${attrs}${styleAttr}${aria}>${children}</${component}>`;
  }
  if (node.type === "TEXT") {
    const text = escapeHtml(node.characters ?? "");
    return `<${tag} ${attrs}${styleAttr}${aria}>${text}</${tag}>`;
  }
  if (node.type === "LINE") return `<div ${attrs}${styleAttr}${aria} role="separator"></div>`;
  const childrenMarkup = children || (tag === "button" ? escapeHtml(node.name ?? "Action") : "");
  const positionHint = parentLayout === "NONE" ? ` data-layout="absolute"` : "";
  return `<${tag} ${attrs}${styleAttr}${aria}${positionHint}>${childrenMarkup}</${tag}>`;
}

function nodeCss(node: FigmaNode, tokens: DesignToken[], parentLayout = "NONE"): string {
  if (node.type === "PAGE" || node.type === "DOCUMENT") return (node.children ?? []).map((child) => nodeCss(child, tokens, "NONE")).join("\n");
  const bounds = { width: node.width ?? 0, height: node.height ?? 0 };
  const fill = paintValue(node, tokens);
  const paint = visibleFill(node);
  const stroke = node.strokes?.find((paintItem) => paintItem.visible !== false);
  const imagePaint = node.fills?.find((paintItem) => paintItem.type === "IMAGE");
  const selector = `.${nodeClass(node).replace("ls-node ", "")}`;
  const declarations = [
    `box-sizing:border-box`,
    `width:${Math.max(0, bounds.width)}px`,
    `height:${Math.max(0, bounds.height)}px`,
    `opacity:${node.opacity ?? 1}`,
  ];
  if (parentLayout === "NONE") declarations.push(`position:absolute`, `left:${node.x ?? 0}px`, `top:${node.y ?? 0}px`);
  else declarations.push("position:relative");
  if (node.type !== "TEXT" && node.type !== "LINE" && paint) declarations.push(`background:${fill.value}`);
  if (imagePaint?.imageRef) {
    const media = node.labelMedia;
    const assetName = imagePaint.imageRef.split("/").pop() ?? imagePaint.imageRef;
    declarations.push(`background-image:url("./assets/${assetName}")`, `background-size:${imagePaint.scaleMode === "FIT" ? "contain" : imagePaint.scaleMode === "STRETCH" ? "100% 100%" : "cover"}`, "background-position:center", "background-repeat:no-repeat");
    if (media?.adjustments) declarations.push(`filter:brightness(${1 + media.adjustments.brightness}) contrast(${1 + media.adjustments.contrast}) saturate(${1 + media.adjustments.saturation}) grayscale(${media.adjustments.grayscale}) blur(${Math.max(0, media.adjustments.blur)}px)`);
  }
  if (node.studioGlass?.enabled) declarations.push(`backdrop-filter:blur(${Math.max(0, node.studioGlass.blur)}px)`, "background:rgba(255,255,255,.18)");
  if (node.cornerRadius) declarations.push(`border-radius:${node.cornerRadius}px`);
  if (node.rotation) declarations.push(`transform:rotate(${node.rotation}deg)`);
  if (node.clipContent) declarations.push("overflow:hidden");
  if (node.type === "TEXT") {
    const style = node.style ?? {};
    declarations.push(`color:${paint ? fill.value : "#111111"}`, `font-family:${JSON.stringify(style.fontFamily ?? "Arial, sans-serif")}`, `font-size:${style.fontSize ?? 16}px`, `font-weight:${style.fontWeight ?? 400}`, `line-height:${style.lineHeightPx ?? Math.round((style.fontSize ?? 16) * 1.4)}px`, `white-space:pre-wrap`);
    if (style.textAlignHorizontal) declarations.push(`text-align:${style.textAlignHorizontal.toLowerCase()}`);
  }
  if (node.type === "LINE") declarations.push("height:1px", `background:${cssColor(stroke)}`);
  if (isContainerNode(node) && node.layoutMode && node.layoutMode !== "NONE") {
    declarations.push("display:flex", `flex-direction:${node.layoutMode === "HORIZONTAL" ? "row" : "column"}`, `gap:${node.itemSpacing ?? 0}px`, `padding:${node.paddingTop ?? 0}px ${node.paddingRight ?? 0}px ${node.paddingBottom ?? 0}px ${node.paddingLeft ?? 0}px`);
    if (node.primaryAxisAlignItems) declarations.push(`justify-content:${node.primaryAxisAlignItems === "MAX" ? "flex-end" : node.primaryAxisAlignItems === "CENTER" ? "center" : "flex-start"}`);
    if (node.counterAxisAlignItems) declarations.push(`align-items:${node.counterAxisAlignItems === "MAX" ? "flex-end" : node.counterAxisAlignItems === "CENTER" ? "center" : node.counterAxisAlignItems === "STRETCH" ? "stretch" : "flex-start"}`);
  }
  const output = [`${selector}{${declarations.join(";")}}`];
  if (isContainerNode(node)) output.push(...(node.children ?? []).map((child) => nodeCss(child, tokens, node.layoutMode ?? "NONE")));
  return output.join("\n");
}

function tokensCss(tokens: DesignToken[]): string {
  return `:root{\n${tokens.map((token) => `  ${cssTokenName(token)}: ${typeof token.value === "number" ? `${token.value}px` : token.value};`).join("\n")}\n}`;
}

export class CodeExporter {
  private readonly document: FigmaDocument;
  private readonly root: FigmaNode;
  private readonly tokens: DesignToken[];
  private readonly assets: Record<string, Uint8Array>;

  public constructor(document: FigmaDocument, rootId?: string | null, assets: Record<string, Uint8Array> = {}) {
    this.document = document;
    this.tokens = document.labelTokens ?? [];
    this.assets = assets;
    const page = rootId ? findNode(document.document, rootId) : firstPage(document.document);
    this.root = page ?? document.document;
  }

  public html(): string {
    return `<!doctype html>\n<html lang="ko">\n<head>\n  <meta charset="UTF-8" />\n  <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n  <title>${escapeHtml(this.document.name)}</title>\n  <link rel="stylesheet" href="./styles.css" />\n</head>\n<body>\n  <main class="labelstudio-root">${nodeMarkup(this.root, this.tokens)}</main>\n</body>\n</html>`;
  }

  public react(): string {
    const body = nodeMarkup(this.root, this.tokens, true);
    const imports = new Map<string, string>();
    walk(this.root, (node) => {
      if (node.labelComponentName && node.labelImportPath) {
        const component = componentIdentifier(node.labelComponentName);
        if (!imports.has(component)) imports.set(component, `import ${component} from ${JSON.stringify(node.labelImportPath)};`);
      }
    });
    return `import React from "react";\n${[...imports.values()].join("\n")}\nimport "./styles.css";\n\nexport default function LabelStudioBoard() {\n  return (\n    <main className="labelstudio-root">${body}</main>\n  );\n}\n`;
  }

  public css(): string {
    return `${tokensCss(this.tokens)}\n\n*{box-sizing:border-box}\nbody{margin:0;background:#FFFFFF;color:#111111;font-family:Arial,sans-serif}\n.labelstudio-root{position:relative;min-width:320px;min-height:100vh}\n${nodeCss(this.root, this.tokens)}`;
  }

  public report(): HandoffReport {
    const issues: HandoffIssue[] = [];
    walk(this.root, (node) => {
      if (!node.name) issues.push({ severity: "WARNING", nodeId: node.id, title: "이름 없는 레이어", detail: "개발자 코드의 안정적인 식별을 위해 레이어 이름을 지정하세요." });
      if (node.type === "TEXT" && !node.characters) issues.push({ severity: "BLOCKER", nodeId: node.id, title: "빈 텍스트", detail: "콘텐츠가 없는 텍스트는 코드 export 전에 의미를 확인해야 합니다." });
      if (node.type === "TEXT" && !node.style?.fontFamily) issues.push({ severity: "WARNING", nodeId: node.id, title: "폰트 미지정", detail: "font-family fallback이 추론됩니다." });
      if (!['PAGE', 'DOCUMENT'].includes(node.type) && (node.width === undefined || node.height === undefined)) issues.push({ severity: "WARNING", nodeId: node.id, title: "크기 미지정", detail: "반응형 규칙을 설정하지 않으면 export 값이 추론됩니다." });
      if ((node.labelSemantic === "button" || node.labelSemantic === "link") && !node.labelAccessibleName && node.type !== "TEXT") issues.push({ severity: "BLOCKER", nodeId: node.id, title: "접근 가능한 이름 없음", detail: "button/link에는 screen reader가 읽을 이름을 지정하세요." });
      if (node.type === "IMAGE" || node.fills?.some((paint) => paint.type === "IMAGE")) issues.push({ severity: "INFO", nodeId: node.id, title: "Asset 확인 필요", detail: "이미지 경로와 alt 텍스트를 확인하세요." });
      if (node.fills?.some((paint) => paint.type === "IMAGE") && !node.labelMedia?.alt && !node.labelAccessibleName) issues.push({ severity: "BLOCKER", nodeId: node.id, title: "이미지 alt 없음", detail: "미디어 보정 패널에서 설명을 지정하세요." });
    });
    if (this.tokens.length === 0) issues.push({ severity: "INFO", title: "디자인 토큰 없음", detail: "raw color 대신 LabelStudio 토큰을 사용하면 theme 변경이 쉬워집니다." });
    return { generatedAt: this.document.lastModified ?? "1970-01-01T00:00:00.000Z", documentName: this.document.name, nodeCount: countNodes(this.root), issues };
  }

  public package(): Uint8Array {
    const report = this.report();
    const readme = `# LabelStudio handoff\n\nGenerated from ${this.document.name}.\n\n- Nodes: ${report.nodeCount}\n- Blockers: ${report.issues.filter((issue) => issue.severity === "BLOCKER").length}\n- Warnings: ${report.issues.filter((issue) => issue.severity === "WARNING").length}\n\nReview handoff.manifest.json before shipping.\n`;
    const files: Record<string, Uint8Array> = {
      "index.html": strToU8(this.html()),
      "styles.css": strToU8(this.css()),
      "components/LabelStudioBoard.tsx": strToU8(this.react()),
      "tokens.css": strToU8(tokensCss(this.tokens)),
      "handoff.manifest.json": strToU8(JSON.stringify(report, null, 2)),
      "README.md": strToU8(readme),
    };
    const referenced = new Set(Object.values(this.document.labelAssets ?? {}).map((asset) => asset.path));
    walk(this.root, (node) => {
      node.fills?.forEach((paint) => { if (paint.type === "IMAGE" && paint.imageRef) referenced.add(paint.imageRef); });
    });
    for (const [path, bytes] of Object.entries(this.assets)) {
      if (path.endsWith(".fig.json") || (referenced.size > 0 && !referenced.has(path))) continue;
      files[`assets/${path.split("/").pop() ?? path}`] = bytes;
    }
    return zipSync(files, { level: 6 });
  }
}

export function downloadCodePackage(bytes: Uint8Array, filename: string): void {
  const blob = new Blob([bytes as BlobPart], { type: "application/zip" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
