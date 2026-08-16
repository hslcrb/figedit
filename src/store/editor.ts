import { create } from "zustand";
import type { FigmaDocument, FigmaNode, FigmaNodeType } from "../types/figma";
import { getNodeBounds, isContainerNode } from "../types/figma";
import {
  addChild,
  duplicateNode as dupNode,
  findNode,
  firstPage,
  getRootPageIds,
  makeNode,
  moveNodeInParent,
  removeNode,
  replaceNode,
  updateNode as updateNodeInTree,
} from "../lib/figma";
import { apply, multiply, scaling, translation } from "../lib/matrix";

interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

interface EditorState {
  doc: FigmaDocument | null;
  activePageId: string | null;
  selectedId: string | null;
  viewport: Viewport;
  fileName: string;
  canUndo: boolean;
  canRedo: boolean;
  extraFiles: Record<string, Uint8Array>;

  loadDoc: (doc: FigmaDocument, fileName: string, extraFiles?: Record<string, Uint8Array>) => void;
  unload: () => void;
  select: (id: string | null) => void;
  setActivePage: (id: string) => void;
  updateNode: (id: string, patch: Partial<FigmaNode>) => void;
  addChild: (parentId: string, type: FigmaNodeType) => string | null;
  deleteNode: (id: string) => void;
  duplicateNode: (id: string) => void;
  startMove: (id: string) => void;
  moveNode: (id: string, dx: number, dy: number) => void;
  reorderNode: (id: string, direction: -1 | 1) => void;
  setViewport: (viewport: Viewport) => void;
  zoomBy: (factor: number, cx: number, cy: number) => void;
  fitToContent: () => void;
  recenter: () => void;
  undo: () => void;
  redo: () => void;
}

const HISTORY_LIMIT = 100;

function cloneDoc(doc: FigmaDocument): FigmaDocument {
  return JSON.parse(JSON.stringify(doc)) as FigmaDocument;
}

function computePageBounds(page: FigmaNode): { x: number; y: number; width: number; height: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const child of page.children ?? []) {
    const b = getNodeBounds(child);
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.width);
    maxY = Math.max(maxY, b.y + b.height);
  }
  if (minX === Infinity) return { x: 0, y: 0, width: 1000, height: 800 };
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export const useEditorStore = create<EditorState>((set, get) => {
  const past: FigmaDocument[] = [];
  const future: FigmaDocument[] = [];

  function snapshot(): void {
    const { doc } = get();
    if (!doc) return;
    past.push(cloneDoc(doc));
    if (past.length > HISTORY_LIMIT) past.shift();
    future.length = 0;
  }

  function commit(doc: FigmaDocument, opts: { pushHistory?: boolean; select?: string | null } = {}): void {
    if (opts.pushHistory) snapshot();
    set({ doc, canUndo: past.length > 0, canRedo: future.length > 0, ...(opts.select !== undefined ? { selectedId: opts.select } : {}) });
  }

  return {
    doc: null,
    activePageId: null,
    selectedId: null,
    viewport: { x: 0, y: 0, zoom: 1 },
    fileName: "Untitled.fig",
    canUndo: false,
    canRedo: false,
    extraFiles: {},

    loadDoc: (doc, fileName, extraFiles = {}) => {
      const page = firstPage(doc.document);
      const activePageId = page?.id ?? null;
      let viewport = { x: 0, y: 0, zoom: 1 };
      if (page) {
        const bounds = computePageBounds(page);
        const vw = 1000;
        const vh = 800;
        const zoom = Math.max(0.05, Math.min(1, Math.min(vw / Math.max(bounds.width, 1), vh / Math.max(bounds.height, 1))));
        viewport = {
          x: (vw - bounds.width * zoom) / 2 - bounds.x * zoom,
          y: (vh - bounds.height * zoom) / 2 - bounds.y * zoom,
          zoom,
        };
      }
      past.length = 0;
      future.length = 0;
      set({ doc, fileName, activePageId, selectedId: null, viewport, canUndo: false, canRedo: false, extraFiles });
    },

    unload: () => {
      past.length = 0;
      future.length = 0;
      set({ doc: null, activePageId: null, selectedId: null, viewport: { x: 0, y: 0, zoom: 1 }, fileName: "Untitled.fig", canUndo: false, canRedo: false, extraFiles: {} });
    },

    select: (id) => set({ selectedId: id }),

    setActivePage: (id) => set({ activePageId: id, selectedId: null }),

    updateNode: (id, patch) => {
      const state = get();
      if (!state.doc) return;
      const doc = { ...state.doc, document: updateNodeInTree(state.doc.document, id, patch) };
      commit(doc, { pushHistory: true });
    },

    addChild: (parentId, type) => {
      const state = get();
      if (!state.doc) return null;
      const parent = findNode(state.doc.document, parentId);
      if (!parent || !isContainerNode(parent)) return null;
      const node = makeNode(type, parent);
      const doc = { ...state.doc, document: replaceNode(state.doc.document, parentId, addChild(parent, node)) };
      commit(doc, { pushHistory: true, select: node.id ?? null });
      return node.id ?? null;
    },

    deleteNode: (id) => {
      const state = get();
      if (!state.doc) return;
      const { root, removed } = removeNode(state.doc.document, id);
      if (!removed) return;
      commit({ ...state.doc, document: root }, { pushHistory: true, select: null });
    },

    duplicateNode: (id) => {
      const state = get();
      if (!state.doc) return;
      const { root, newId } = dupNode(state.doc.document, id);
      if (newId) commit({ ...state.doc, document: root }, { pushHistory: true, select: newId });
    },

    startMove: (_id) => {
      const state = get();
      if (!state.doc) return;
      snapshot();
      set({ canUndo: past.length > 0, canRedo: future.length > 0 });
    },

    moveNode: (id, dx, dy) => {
      const state = get();
      if (!state.doc) return;
      const node = findNode(state.doc.document, id);
      if (!node) return;
      const x = (node.x ?? 0) + dx;
      const y = (node.y ?? 0) + dy;
      const doc = { ...state.doc, document: updateNodeInTree(state.doc.document, id, { x, y }) };
      commit(doc);
    },

    reorderNode: (id, direction) => {
      const state = get();
      if (!state.doc) return;
      const doc = { ...state.doc, document: moveNodeInParent(state.doc.document, id, direction) };
      commit(doc, { pushHistory: true });
    },

    setViewport: (viewport) => set({ viewport }),

    zoomBy: (factor, cx, cy) => {
      const { viewport } = get();
      const zoom = Math.max(0.05, Math.min(8, viewport.zoom * factor));
      const k = zoom / viewport.zoom;
      set({
        viewport: {
          zoom,
          x: cx - (cx - viewport.x) * k,
          y: cy - (cy - viewport.y) * k,
        },
      });
    },

    fitToContent: () => {
      const state = get();
      if (!state.doc || !state.activePageId) return;
      const page = findNode(state.doc.document, state.activePageId);
      if (!page) return;
      const bounds = computePageBounds(page);
      const canvas = document.querySelector<HTMLCanvasElement>("canvas[data-editor-canvas]");
      const vw = canvas?.clientWidth ?? 1000;
      const vh = canvas?.clientHeight ?? 800;
      const pad = 48;
      const zoom = Math.max(
        0.05,
        Math.min(1, Math.min((vw - pad * 2) / Math.max(bounds.width, 1), (vh - pad * 2) / Math.max(bounds.height, 1))),
      );
      const m = multiply(translation(vw / 2, vh / 2), scaling(zoom, zoom));
      const [centerX, centerY] = apply(m, -(bounds.x + bounds.width / 2), -(bounds.y + bounds.height / 2));
      set({
        viewport: {
          x: centerX + bounds.x * zoom,
          y: centerY + bounds.y * zoom,
          zoom,
        },
      });
    },

    recenter: () => {
      set({ viewport: { x: 0, y: 0, zoom: 1 } });
    },

    undo: () => {
      const { doc } = get();
      const previous = past.pop();
      if (!previous) return;
      if (doc) future.push(cloneDoc(doc));
      set({ doc: previous, canUndo: past.length > 0, canRedo: future.length > 0 });
    },

    redo: () => {
      const { doc } = get();
      const next = future.pop();
      if (!next) return;
      if (doc) past.push(cloneDoc(doc));
      set({ doc: next, canUndo: past.length > 0, canRedo: future.length > 0 });
    },
  };
});

export function activePageNode(state: EditorState): FigmaNode | null {
  if (!state.doc || !state.activePageId) return null;
  return findNode(state.doc.document, state.activePageId);
}

export function pageIds(state: EditorState): string[] {
  if (!state.doc) return [];
  return getRootPageIds(state.doc.document);
}
