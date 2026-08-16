import type { FigmaDocument, FigmaNode, FigmaNodeType } from "../types/figma";
import { getNodeBounds, isContainerNode } from "../types/figma";

let idCounter = 100;

function nextId(): string {
  idCounter += 1;
  const component = Math.floor(idCounter / 1000);
  const node = idCounter % 1000;
  return `${component}:${node}`;
}

export function resetIdCounter(): void {
  idCounter = 100;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function walk(node: FigmaNode, fn: (node: FigmaNode, depth: number) => boolean | void): void {
  const descend = fn(node, 0);
  if (descend === false || !isContainerNode(node)) return;
  for (const child of node.children ?? []) {
    walk(child, (n, d) => fn(n, d + 1));
  }
}

export function walkBreadthFirst(node: FigmaNode, fn: (node: FigmaNode) => boolean): FigmaNode | null {
  const queue: FigmaNode[] = [node];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (fn(current)) return current;
    if (isContainerNode(current)) queue.push(...(current.children ?? []));
  }
  return null;
}

export function findNode(root: FigmaNode, id: string | undefined | null): FigmaNode | null {
  if (!id) return null;
  return walkBreadthFirst(root, (n) => n.id === id);
}

export function findParent(root: FigmaNode, id: string): { parent: FigmaNode; index: number } | null {
  if (!isContainerNode(root)) return null;
  const children = root.children ?? [];
  for (let i = 0; i < children.length; i++) {
    if (children[i].id === id) return { parent: root, index: i };
    const found = findParent(children[i], id);
    if (found) return found;
  }
  return null;
}

export function pageOf(root: FigmaNode, id: string): FigmaNode | null {
  if (root.type === "PAGE" && root.id === id) return root;
  if (isContainerNode(root)) {
    for (const child of root.children ?? []) {
      const found = pageOf(child, id);
      if (found) return found;
    }
  }
  return null;
}

export function firstPage(doc: FigmaNode): FigmaNode | null {
  const pages = (doc.children ?? []).filter((n) => n.type === "PAGE");
  return pages[0] ?? null;
}

export function ancestorPages(doc: FigmaNode): FigmaNode[] {
  return (doc.children ?? []).filter((n) => n.type === "PAGE");
}

function cloneWithNewId(node: FigmaNode, newName?: string): FigmaNode {
  const copy = clone(node);
  copy.id = nextId();
  if (newName) copy.name = newName;
  if (isContainerNode(copy)) {
    copy.children = (copy.children ?? []).map((child) => cloneWithNewId(child));
  }
  return copy;
}

export function makeNode(
  type: FigmaNodeType,
  _parent: FigmaNode,
  opts: Partial<FigmaNode> = {},
): FigmaNode {
  const base: FigmaNode = {
    id: nextId(),
    type,
    name: defaultName(type),
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    visible: true,
    opacity: 1,
  };

  switch (type) {
    case "PAGE":
      base.width = undefined;
      base.height = undefined;
      base.x = undefined;
      base.y = undefined;
      base.fills = undefined;
      break;
    case "FRAME":
    case "COMPONENT":
    case "COMPONENT_SET":
    case "INSTANCE":
    case "SECTION":
    case "GROUP": {
      base.clipContent = type === "FRAME";
      base.fills = [
        { type: "SOLID", color: { r: 0.9, g: 0.9, b: 0.93 }, opacity: 1 },
      ];
      base.layoutMode = "NONE";
      base.children = [];
      base.strokes = [];
      base.effects = [];
      base.constraints = { horizontal: "SCALE", vertical: "SCALE" };
      break;
    }
    case "RECTANGLE": {
      base.fills = [{ type: "SOLID", color: { r: 0.4, g: 0.5, b: 1 }, opacity: 1 }];
      base.cornerRadius = 0;
      base.strokes = [];
      base.effects = [];
      base.constraints = { horizontal: "SCALE", vertical: "SCALE" };
      break;
    }
    case "ELLIPSE": {
      base.fills = [{ type: "SOLID", color: { r: 0.4, g: 0.8, b: 0.6 }, opacity: 1 }];
      base.strokes = [];
      base.effects = [];
      break;
    }
    case "LINE": {
      base.width = 100;
      base.height = 0;
      base.fills = [];
      base.strokes = [{ type: "SOLID", color: { r: 0, g: 0, b: 0 }, opacity: 1 }];
      base.strokeWeight = 2;
      base.strokeCap = "ROUND";
      base.strokeAlign = "CENTER";
      break;
    }
    case "TEXT": {
      base.fills = [{ type: "SOLID", color: { r: 0, g: 0, b: 0 }, opacity: 1 }];
      base.characters = "텍스트";
      base.style = {
        fontFamily: "Inter",
        fontPostScriptName: "Inter-Regular",
        fontWeight: 400,
        fontSize: 24,
        textAlignHorizontal: "LEFT",
        letterSpacing: 0,
        lineHeightPx: 29,
      };
      base.textAutoResize = "HEIGHT";
      break;
    }
    default: {
      base.fills = [{ type: "SOLID", color: { r: 0.6, g: 0.4, b: 0.8 }, opacity: 1 }];
      base.strokes = [];
      base.effects = [];
    }
  }

  const merged = { ...base, ...opts };
  if (type === "PAGE") {
    merged.x = undefined;
    merged.y = undefined;
    merged.width = undefined;
    merged.height = undefined;
  }
  return merged;
}

function defaultName(type: FigmaNodeType): string {
  switch (type) {
    case "PAGE":
      return "페이지";
    case "FRAME":
      return "프레임";
    case "GROUP":
      return "그룹";
    case "RECTANGLE":
      return "사각형";
    case "ELLIPSE":
      return "타원";
    case "LINE":
      return "선";
    case "TEXT":
      return "텍스트";
    case "POLYGON":
      return "다각형";
    case "STAR":
      return "별";
    case "VECTOR":
      return "벡터";
    case "COMPONENT":
      return "컴포넌트";
    case "COMPONENT_SET":
      return "컴포넌트 세트";
    case "INSTANCE":
      return "인스턴스";
    case "SECTION":
      return "섹션";
    case "SLICE":
      return "슬라이스";
    default:
      return type.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
  }
}

export function addChild(parent: FigmaNode, node: FigmaNode): FigmaNode {
  if (!isContainerNode(parent)) return parent;
  return {
    ...parent,
    children: [...(parent.children ?? []), clone(node)],
  };
}

export function insertChild(parent: FigmaNode, node: FigmaNode, index: number): FigmaNode {
  if (!isContainerNode(parent)) return parent;
  const children = [...(parent.children ?? [])];
  children.splice(index, 0, clone(node));
  return { ...parent, children };
}

export function removeNode(root: FigmaNode, id: string): { root: FigmaNode; removed: FigmaNode | null } {
  if (root.id === id) return { root: { ...root, children: [] }, removed: root };
  if (!isContainerNode(root)) return { root, removed: null };
  const children = root.children ?? [];
  for (let i = 0; i < children.length; i++) {
    if (children[i].id === id) {
      const removed = children[i];
      const next = [...children];
      next.splice(i, 1);
      return { root: { ...root, children: next }, removed };
    }
    const result = removeNode(children[i], id);
    if (result.removed) {
      const next = [...children];
      next[i] = result.root;
      return { root: { ...root, children: next }, removed: result.removed };
    }
  }
  return { root, removed: null };
}

export function updateNode(root: FigmaNode, id: string, patch: Partial<FigmaNode>): FigmaNode {
  if (root.id === id) return { ...root, ...patch };
  if (!isContainerNode(root)) return root;
  return {
    ...root,
    children: (root.children ?? []).map((child) => updateNode(child, id, patch)),
  };
}

export function replaceNode(root: FigmaNode, id: string, replacement: FigmaNode): FigmaNode {
  if (root.id === id) return replacement;
  if (!isContainerNode(root)) return root;
  return {
    ...root,
    children: (root.children ?? []).map((child) => (child.id === id ? replacement : replaceNode(child, id, replacement))),
  };
}

export function duplicateNode(root: FigmaNode, id: string): { root: FigmaNode; newId: string | null } {
  const parentInfo = findParent(root, id);
  if (!parentInfo) return { root, newId: null };
  const original = parentInfo.parent.children?.[parentInfo.index];
  if (!original) return { root, newId: null };
  const copy = cloneWithNewId(original);
  const width = getNodeBounds(original).width;
  copy.x = (copy.x ?? 0) + width + 16;
  copy.name = `${original.name} 복사`;
  return { root: insertChild(parentInfo.parent, copy, parentInfo.index + 1), newId: copy.id ?? null };
}

export function moveNodeInParent(root: FigmaNode, id: string, direction: -1 | 1): FigmaNode {
  const parentInfo = findParent(root, id);
  if (!parentInfo) return root;
  const children = parentInfo.parent.children ?? [];
  const target = parentInfo.index + direction;
  if (target < 0 || target >= children.length) return root;
  const next = [...children];
  const [moved] = next.splice(parentInfo.index, 1);
  next.splice(target, 0, moved);
  return replaceNode(root, parentInfo.parent.id ?? "", { ...parentInfo.parent, children: next });
}

export function getRootPageIds(doc: FigmaNode): string[] {
  return (doc.children ?? []).filter((n) => n.type === "PAGE").map((n) => n.id) as string[];
}

export function countNodes(node: FigmaNode): number {
  let count = 1;
  if (isContainerNode(node)) {
    for (const child of node.children ?? []) count += countNodes(child);
  }
  return count;
}

export function randomFill(): FigmaNode["fills"] {
  const r = Math.random();
  const g = Math.random();
  const b = Math.random();
  return [{ type: "SOLID", color: { r, g, b }, opacity: 1 }];
}

export function createNewDocument(fileName = "새 파일.fig"): { doc: FigmaDocument; fileName: string } {
  const page = makeNode("PAGE", { children: [] } as unknown as FigmaNode);
  const frame = makeNode("FRAME", page, {
    name: "프레임",
    x: 0,
    y: 0,
    width: 375,
    height: 812,
    fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1 }, opacity: 1 }],
  });
  const rect = makeNode("RECTANGLE", frame, {
    name: "사각형",
    x: 48,
    y: 96,
    width: 280,
    height: 160,
    cornerRadius: 16,
    fills: [{ type: "SOLID", color: { r: 0.2, g: 0.55, b: 0.95 }, opacity: 1 }],
  });
  const text = makeNode("TEXT", frame, {
    name: "텍스트",
    x: 48,
    y: 300,
    width: 280,
    characters: "FigEdit",
    style: {
      fontFamily: "Inter",
      fontPostScriptName: "Inter-SemiBold",
      fontWeight: 600,
      fontSize: 32,
      textAlignHorizontal: "LEFT",
      lineHeightPx: 38,
    },
  });
  const ellipse = makeNode("ELLIPSE", frame, {
    name: "타원",
    x: 96,
    y: 400,
    width: 120,
    height: 120,
    fills: [{ type: "SOLID", color: { r: 0.96, g: 0.62, b: 0.1 }, opacity: 1 }],
  });

  page.children = [frame];
  frame.children = [rect, text, ellipse];

  const doc: FigmaDocument = {
    name: fileName.replace(/\.fig$/i, ""),
    version: "1.0.0",
    lastModified: new Date().toISOString(),
    thumbnailUrl: null,
    document: {
      id: "0:0",
      type: "DOCUMENT",
      name: "Document",
      children: [page],
    },
  };
  return { doc, fileName };
}
