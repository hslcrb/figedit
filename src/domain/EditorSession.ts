import type { FigmaDocument, FigmaNode, FigmaNodeType } from "../types/figma";
import type { MediaAsset, PathPoint } from "../types/design";
import { DEFAULT_MEDIA_ADJUSTMENTS, FULL_MEDIA_CROP } from "../types/design";
import { getNodeBounds, isContainerNode } from "../types/figma";
import {
  addChild,
  duplicateNode as duplicateTreeNode,
  findNode,
  findParent,
  makeNode,
  moveNodeInParent,
  removeNode,
  replaceNode,
  syncIdCounter,
  updateNode,
} from "../lib/figma";
import { AutoLayoutEngine } from "./AutoLayoutEngine";
import { combineBasicNodes, type BasicBooleanMode } from "../lib/boolean";
import { normalizePath } from "../lib/path";

export interface MutationResult {
  document: FigmaDocument;
  nodeId: string | null;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function nodePreset(type: FigmaNodeType): Partial<FigmaNode> {
  switch (type) {
    case "FRAME":
      return { width: 320, height: 220 };
    case "RECTANGLE":
      return { width: 160, height: 96 };
    case "ELLIPSE":
      return { width: 120, height: 120 };
    case "TEXT":
      return { width: 240, height: 52 };
    case "LINE":
      return { width: 180, height: 0 };
    default:
      return {};
  }
}

/**
 * Owns document mutations and history so the UI only describes intent.
 * The session is deliberately format-agnostic even though it currently
 * serializes through the Figma-compatible node model.
 */
export class EditorSession {
  private current: FigmaDocument | null = null;
  private readonly past: FigmaDocument[] = [];
  private readonly future: FigmaDocument[] = [];
  private readonly autoLayout = new AutoLayoutEngine();
  private transactionOpen = false;

  public get document(): FigmaDocument | null {
    return this.current;
  }

  public get canUndo(): boolean {
    return this.past.length > 0;
  }

  public get canRedo(): boolean {
    return this.future.length > 0;
  }

  public open(document: FigmaDocument): FigmaDocument {
    syncIdCounter(document.document);
    this.current = clone(document);
    this.past.length = 0;
    this.future.length = 0;
    this.transactionOpen = false;
    return this.current;
  }

  public close(): void {
    this.current = null;
    this.past.length = 0;
    this.future.length = 0;
    this.transactionOpen = false;
  }

  private remember(): boolean {
    if (!this.current) return false;
    this.past.push(clone(this.current));
    if (this.past.length > 100) this.past.shift();
    this.future.length = 0;
    return true;
  }

  private commit(next: FigmaDocument, remember = true): FigmaDocument {
    if (remember || this.transactionOpen) {
      this.remember();
      this.transactionOpen = false;
    }
    this.current = next;
    return next;
  }

  public updateNode(id: string, patch: Partial<FigmaNode>): MutationResult | null {
    if (!this.current) return null;
    const target = findNode(this.current.document, id);
    if (!target) return null;
    let nextDocument = updateNode(this.current.document, id, patch);
    if (target.type === "COMPONENT") {
      const instancePatch = { ...patch };
      delete instancePatch.id;
      delete instancePatch.type;
      delete instancePatch.children;
      nextDocument = this.propagateInstancePatch(nextDocument, id, instancePatch);
    }
    const next = { ...this.current, document: nextDocument };
    this.commit(next);
    return { document: next, nodeId: id };
  }

  private propagateInstancePatch(root: FigmaNode, componentId: string, patch: Partial<FigmaNode>): FigmaNode {
    if (root.type === "INSTANCE" && root.labelComponentId === componentId) return { ...root, ...patch, type: "INSTANCE", labelComponentId: componentId };
    if (!isContainerNode(root)) return root;
    return { ...root, children: (root.children ?? []).map((child) => this.propagateInstancePatch(child, componentId, patch)) };
  }

  public updateDocument(patch: Partial<FigmaDocument>): FigmaDocument | null {
    if (!this.current) return null;
    const next = { ...this.current, ...patch };
    this.commit(next);
    return next;
  }

  public addPage(name = "새 페이지"): MutationResult | null {
    if (!this.current || !isContainerNode(this.current.document)) return null;
    const page = makeNode("PAGE", this.current.document, { name, children: [] });
    const next = { ...this.current, document: { ...this.current.document, children: [...(this.current.document.children ?? []), page] } };
    this.commit(next);
    return { document: next, nodeId: page.id ?? null };
  }

  public addChild(parentId: string, type: FigmaNodeType, position?: { x: number; y: number }): MutationResult | null {
    if (!this.current) return null;
    const parent = findNode(this.current.document, parentId);
    if (!parent || !isContainerNode(parent)) return null;
    const node = makeNode(type, parent, {
      ...nodePreset(type),
      ...(position ?? { x: 24, y: 24 }),
    });
    let nextDocument = replaceNode(this.current.document, parentId, addChild(parent, node));
    const insertedParent = findNode(nextDocument, parentId);
    if (insertedParent?.layoutMode && insertedParent.layoutMode !== "NONE") {
      nextDocument = updateNode(nextDocument, parentId, this.autoLayout.arrange(insertedParent));
    }
    const next = { ...this.current, document: nextDocument };
    this.commit(next);
    return { document: next, nodeId: node.id ?? null };
  }

  public addPath(parentId: string, points: PathPoint[], closed: boolean): MutationResult | null {
    if (!this.current || points.length < 2) return null;
    const parent = findNode(this.current.document, parentId);
    if (!parent || !isContainerNode(parent)) return null;
    const normalized = normalizePath(points, closed);
    const node = makeNode("VECTOR", parent, {
      name: "Path",
      x: normalized.bounds.x,
      y: normalized.bounds.y,
      width: normalized.bounds.width,
      height: normalized.bounds.height,
      labelPath: normalized.path,
      fills: closed ? [{ type: "SOLID", color: { r: 0.85, g: 1, b: 0.29 }, opacity: 1 }] : [],
      strokes: closed ? [] : [{ type: "SOLID", color: { r: 0.07, g: 0.07, b: 0.07 }, opacity: 1 }],
      strokeWeight: 2,
    });
    let nextDocument = replaceNode(this.current.document, parentId, addChild(parent, node));
    const insertedParent = findNode(nextDocument, parentId);
    if (insertedParent?.layoutMode && insertedParent.layoutMode !== "NONE") nextDocument = updateNode(nextDocument, parentId, this.autoLayout.arrange(insertedParent));
    const next = { ...this.current, document: nextDocument };
    this.commit(next);
    return { document: next, nodeId: node.id ?? null };
  }

  public addMedia(parentId: string, asset: MediaAsset, position?: { x: number; y: number }): MutationResult | null {
    if (!this.current) return null;
    const parent = findNode(this.current.document, parentId);
    if (!parent || !isContainerNode(parent)) return null;
    const width = Math.min(720, Math.max(160, asset.width || 480));
    const height = Math.max(90, Math.round(width * (asset.height || 9) / Math.max(asset.width || 16, 1)));
    const node = makeNode("RECTANGLE", parent, {
      name: asset.originalName.replace(/\.[^.]+$/, ""),
      ...(position ?? { x: 24, y: 24 }),
      width,
      height,
      fills: [{ type: "IMAGE", imageRef: asset.path, scaleMode: "CROP", visible: true }],
      labelMedia: { assetId: asset.id, crop: { ...FULL_MEDIA_CROP }, adjustments: { ...DEFAULT_MEDIA_ADJUSTMENTS }, alt: asset.originalName },
      cornerRadius: 12,
      strokes: [],
    });
    let nextDocument = replaceNode(this.current.document, parentId, addChild(parent, node));
    const insertedParent = findNode(nextDocument, parentId);
    if (insertedParent?.layoutMode && insertedParent.layoutMode !== "NONE") nextDocument = updateNode(nextDocument, parentId, this.autoLayout.arrange(insertedParent));
    const next = { ...this.current, document: nextDocument, labelAssets: { ...(this.current.labelAssets ?? {}), [asset.id]: asset } };
    this.commit(next);
    return { document: next, nodeId: node.id ?? null };
  }

  public combineNodes(ids: string[], mode: BasicBooleanMode): MutationResult | null {
    if (!this.current || ids.length !== 2) return null;
    const parentInfos = ids.map((id) => this.findParentOf(id));
    if (parentInfos.some((info) => !info) || new Set(parentInfos.map((info) => info?.parent.id)).size !== 1) return null;
    const parent = parentInfos[0]!.parent;
    const nodes = (parent.children ?? []).filter((child) => ids.includes(child.id ?? ""));
    if (nodes.length !== 2) return null;
    const combined = combineBasicNodes(nodes, mode);
    if (!combined?.subpaths?.length) return null;
    const points = combined.subpaths.flat();
    const minX = Math.min(...points.map((point) => point.x));
    const minY = Math.min(...points.map((point) => point.y));
    const maxX = Math.max(...points.map((point) => point.x));
    const maxY = Math.max(...points.map((point) => point.y));
    const subpaths = combined.subpaths.map((subpath) => subpath.map((point) => ({ ...point, x: point.x - minX, y: point.y - minY })));
    const vector = makeNode("VECTOR", parent, {
      name: mode === "UNION" ? "Union" : "Subtract",
      x: minX,
      y: minY,
      width: Math.max(1, maxX - minX),
      height: Math.max(1, maxY - minY),
      fills: nodes[0].fills ?? [{ type: "SOLID", color: { r: 0.85, g: 1, b: 0.29 }, opacity: 1 }],
      strokes: [],
      labelPath: { ...combined, points: subpaths[0], subpaths },
    });
    const selected = new Set(ids);
    const children = [...(parent.children ?? [])];
    const insertAt = Math.min(...parentInfos.map((info) => info!.index));
    const remaining = children.filter((child) => !selected.has(child.id ?? ""));
    remaining.splice(insertAt, 0, vector);
    const next = { ...this.current, document: replaceNode(this.current.document, parent.id!, { ...parent, children: remaining }) };
    this.commit(next);
    return { document: next, nodeId: vector.id ?? null };
  }

  public deleteNode(id: string): MutationResult | null {
    if (!this.current) return null;
    const result = removeNode(this.current.document, id);
    if (!result.removed) return null;
    const next = { ...this.current, document: result.root };
    this.commit(next);
    return { document: next, nodeId: null };
  }

  public deleteNodes(ids: string[]): MutationResult | null {
    if (!this.current || ids.length === 0) return null;
    let root = this.current.document;
    let removed = false;
    for (const id of ids) {
      const result = removeNode(root, id);
      if (result.removed) {
        root = result.root;
        removed = true;
      }
    }
    if (!removed) return null;
    const next = { ...this.current, document: root };
    this.commit(next);
    return { document: next, nodeId: null };
  }

  public duplicateNode(id: string): MutationResult | null {
    if (!this.current) return null;
    const result = duplicateTreeNode(this.current.document, id);
    if (!result.newId) return null;
    const next = { ...this.current, document: result.root };
    this.commit(next);
    return { document: next, nodeId: result.newId };
  }

  public duplicateNodes(ids: string[]): MutationResult | null {
    if (!this.current || ids.length === 0) return null;
    let root = this.current.document;
    const newIds: string[] = [];
    for (const id of ids) {
      const result = duplicateTreeNode(root, id);
      if (result.newId) {
        root = result.root;
        newIds.push(result.newId);
      }
    }
    if (newIds.length === 0) return null;
    const next = { ...this.current, document: root };
    this.commit(next);
    return { document: next, nodeId: newIds[0] ?? null };
  }

  public beginTransform(): void {
    this.transactionOpen = true;
  }

  public moveNode(id: string, dx: number, dy: number): MutationResult | null {
    if (!this.current) return null;
    const node = findNode(this.current.document, id);
    if (!node) return null;
    if (!this.transactionOpen) this.remember();
    const next = {
      ...this.current,
      document: updateNode(this.current.document, id, {
        x: (node.x ?? 0) + dx,
        y: (node.y ?? 0) + dy,
      }),
    };
    this.commit(next, false);
    return { document: next, nodeId: id };
  }

  public moveNodes(ids: string[], dx: number, dy: number): MutationResult | null {
    if (!this.current || ids.length === 0) return null;
    let root = this.current.document;
    let moved = false;
    for (const id of ids) {
      const node = findNode(root, id);
      if (!node) continue;
      root = updateNode(root, id, { x: (node.x ?? 0) + dx, y: (node.y ?? 0) + dy });
      moved = true;
    }
    if (!moved) return null;
    if (!this.transactionOpen) this.remember();
    const next = { ...this.current, document: root };
    this.commit(next, false);
    return { document: next, nodeId: ids[0] ?? null };
  }

  public resizeNode(id: string, width: number, height: number, position?: { x?: number; y?: number }): MutationResult | null {
    if (!this.current) return null;
    const node = findNode(this.current.document, id);
    if (!node) return null;
    if (!this.transactionOpen) this.remember();
    const previousWidth = Math.max(0, node.width ?? 0);
    const previousHeight = Math.max(0, node.height ?? 0);
    const nextWidth = Math.max(0, width);
    const nextHeight = Math.max(0, height);
    let root = updateNode(this.current.document, id, { width: nextWidth, height: nextHeight, ...position });
    const resized = findNode(root, id);
    if (resized?.layoutMode && resized.layoutMode !== "NONE") {
      root = updateNode(root, id, this.autoLayout.arrange(resized));
    } else if (isContainerNode(node)) {
      root = updateNode(root, id, {
        children: this.resizeChildren(node.children ?? [], previousWidth, previousHeight, nextWidth, nextHeight),
      });
    }
    const next = { ...this.current, document: root };
    this.commit(next, false);
    return { document: next, nodeId: id };
  }

  private resizeChildren(children: FigmaNode[], previousWidth: number, previousHeight: number, nextWidth: number, nextHeight: number): FigmaNode[] {
    const widthRatio = previousWidth > 0 ? nextWidth / previousWidth : 1;
    const heightRatio = previousHeight > 0 ? nextHeight / previousHeight : 1;
    return children.map((child) => {
      const constraints = child.constraints ?? {};
      const patch: Partial<FigmaNode> = {};
      if (constraints.horizontal === "MAX") patch.x = (child.x ?? 0) + nextWidth - previousWidth;
      if (constraints.horizontal === "CENTER") patch.x = (child.x ?? 0) + (nextWidth - previousWidth) / 2;
      if (constraints.horizontal === "STRETCH") patch.width = (child.width ?? 0) + nextWidth - previousWidth;
      if (constraints.horizontal === "SCALE") {
        patch.x = (child.x ?? 0) * widthRatio;
        patch.width = (child.width ?? 0) * widthRatio;
      }
      if (constraints.vertical === "MAX") patch.y = (child.y ?? 0) + nextHeight - previousHeight;
      if (constraints.vertical === "CENTER") patch.y = (child.y ?? 0) + (nextHeight - previousHeight) / 2;
      if (constraints.vertical === "STRETCH") patch.height = (child.height ?? 0) + nextHeight - previousHeight;
      if (constraints.vertical === "SCALE") {
        patch.y = (child.y ?? 0) * heightRatio;
        patch.height = (child.height ?? 0) * heightRatio;
      }
      return { ...child, ...patch };
    });
  }

  public alignNodes(ids: string[], axis: "horizontal" | "vertical", mode: "MIN" | "CENTER" | "MAX" | "DISTRIBUTE"): MutationResult | null {
    if (!this.current || ids.length < 2) return null;
    const nodes = ids.map((id) => findNode(this.current!.document, id)).filter((node): node is FigmaNode => Boolean(node));
    if (nodes.length < 2) return null;
    const min = Math.min(...nodes.map((node) => axis === "horizontal" ? node.x ?? 0 : node.y ?? 0));
    const max = Math.max(...nodes.map((node) => axis === "horizontal" ? (node.x ?? 0) + (node.width ?? 0) : (node.y ?? 0) + (node.height ?? 0)));
    const center = (min + max) / 2;
    let root = this.current.document;
    const ordered = [...nodes].sort((a, b) => (axis === "horizontal" ? (a.x ?? 0) - (b.x ?? 0) : (a.y ?? 0) - (b.y ?? 0)));
    const totalSize = ordered.reduce((sum, node) => sum + (axis === "horizontal" ? node.width ?? 0 : node.height ?? 0), 0);
    const gap = ordered.length > 1 ? (max - min - totalSize) / (ordered.length - 1) : 0;
    ordered.forEach((node, index) => {
      let value = axis === "horizontal" ? node.x ?? 0 : node.y ?? 0;
      if (mode === "MIN") value = min;
      if (mode === "CENTER") value = center - (axis === "horizontal" ? node.width ?? 0 : node.height ?? 0) / 2;
      if (mode === "MAX") value = max - (axis === "horizontal" ? node.width ?? 0 : node.height ?? 0);
      if (mode === "DISTRIBUTE") {
        value = min + ordered.slice(0, index).reduce((sum, item) => sum + (axis === "horizontal" ? item.width ?? 0 : item.height ?? 0) + gap, 0);
      }
      root = updateNode(root, node.id!, axis === "horizontal" ? { x: value } : { y: value });
    });
    const next = { ...this.current, document: root };
    this.commit(next);
    return { document: next, nodeId: ids[0] ?? null };
  }

  public arrangeNode(id: string): MutationResult | null {
    if (!this.current) return null;
    const node = findNode(this.current.document, id);
    if (!node) return null;
    const arranged = this.autoLayout.arrange(node);
    const next = { ...this.current, document: updateNode(this.current.document, id, arranged) };
    this.commit(next);
    return { document: next, nodeId: id };
  }

  public groupNodes(ids: string[]): MutationResult | null {
    if (!this.current || ids.length < 2) return null;
    const parentInfos = ids.map((id) => this.findParentOf(id));
    if (parentInfos.some((info) => !info) || new Set(parentInfos.map((info) => info?.parent.id)).size !== 1) return null;
    const parent = parentInfos[0]!.parent;
    const selectedSet = new Set(ids);
    const selected = (parent.children ?? []).filter((node) => selectedSet.has(node.id ?? ""));
    const minX = Math.min(...selected.map((node) => node.x ?? 0));
    const minY = Math.min(...selected.map((node) => node.y ?? 0));
    const maxX = Math.max(...selected.map((node) => (node.x ?? 0) + (node.width ?? 0)));
    const maxY = Math.max(...selected.map((node) => (node.y ?? 0) + (node.height ?? 0)));
    const group = makeNode("GROUP", parent, {
      name: "Group",
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY,
      fills: [],
      children: selected.map((node) => ({ ...clone(node), x: (node.x ?? 0) - minX, y: (node.y ?? 0) - minY })),
    });
    const children = [...(parent.children ?? [])];
    const insertAt = Math.min(...parentInfos.map((info) => info!.index));
    const remaining = children.filter((child) => !selectedSet.has(child.id ?? ""));
    remaining.splice(insertAt, 0, group);
    const next = { ...this.current, document: replaceNode(this.current.document, parent.id!, { ...parent, children: remaining }) };
    this.commit(next);
    return { document: next, nodeId: group.id ?? null };
  }

  public ungroupNode(id: string): MutationResult | null {
    if (!this.current) return null;
    const group = findNode(this.current.document, id);
    const parentInfo = this.findParentOf(id);
    if (!group || !parentInfo || !isContainerNode(group)) return null;
    const movedChildren = (group.children ?? []).map((child) => ({ ...clone(child), x: (child.x ?? 0) + (group.x ?? 0), y: (child.y ?? 0) + (group.y ?? 0) }));
    const children = [...(parentInfo.parent.children ?? [])];
    children.splice(parentInfo.index, 1, ...movedChildren);
    const next = { ...this.current, document: replaceNode(this.current.document, parentInfo.parent.id!, { ...parentInfo.parent, children }) };
    this.commit(next);
    return { document: next, nodeId: movedChildren[0]?.id ?? null };
  }

  public makeComponent(id: string): MutationResult | null {
    const node = this.current ? findNode(this.current.document, id) : null;
    if (!node || !isContainerNode(node)) return null;
    const name = (node.name ?? "Component").replace(/\s*component$/i, "");
    const componentName = name.replace(/[^a-zA-Z0-9]+/g, "") || "LabelStudioComponent";
    return this.updateNode(id, { type: "COMPONENT", name: `${name} component`, labelComponentId: id, labelComponentName: componentName });
  }

  public createInstance(id: string): MutationResult | null {
    if (!this.current) return null;
    const source = findNode(this.current.document, id);
    if (!source || !isContainerNode(source)) return null;
    const result = duplicateTreeNode(this.current.document, id);
    if (!result.newId) return null;
    const document = updateNode(result.root, result.newId, {
      type: "INSTANCE",
      labelComponentId: id,
      name: `${source.name ?? "Component"} instance`,
    });
    const next = { ...this.current, document };
    this.commit(next);
    return { document: next, nodeId: result.newId };
  }

  public detachInstance(id: string): MutationResult | null {
    const node = this.current ? findNode(this.current.document, id) : null;
    if (!node || node.type !== "INSTANCE") return null;
    return this.updateNode(id, { type: "FRAME", labelComponentId: undefined, labelComponentName: undefined, labelImportPath: undefined, name: `${node.name ?? "Instance"} detached` });
  }

  public reorderNode(id: string, direction: -1 | 1): MutationResult | null {
    if (!this.current) return null;
    const next = { ...this.current, document: moveNodeInParent(this.current.document, id, direction) };
    this.commit(next);
    return { document: next, nodeId: id };
  }

  public undo(): FigmaDocument | null {
    const previous = this.past.pop();
    if (!previous) return null;
    if (this.current) this.future.push(clone(this.current));
    this.current = previous;
    return previous;
  }

  public redo(): FigmaDocument | null {
    const next = this.future.pop();
    if (!next) return null;
    if (this.current) this.past.push(clone(this.current));
    this.current = next;
    return next;
  }

  public findParentOf(id: string): { parent: FigmaNode; index: number } | null {
    return this.current ? findParent(this.current.document, id) : null;
  }

  public boundsOf(id: string): { x: number; y: number; width: number; height: number } | null {
    const node = this.current ? findNode(this.current.document, id) : null;
    return node ? getNodeBounds(node) : null;
  }
}
