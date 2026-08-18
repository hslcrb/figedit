import { create } from "zustand";
import type { DesignTool, FigmaDocument, FigmaNode, FigmaNodeType } from "../types/figma";
import type { DesignToken, MediaAsset, PathPoint, PrototypeInteraction, WorkspaceMode } from "../types/design";
import { getNodeBounds, isContainerNode } from "../types/figma";
import { findNode, firstPage, getRootPageIds } from "../lib/figma";
import { apply, identity, invert, multiply, scaling, translation } from "../lib/matrix";
import { getWorldTransformOf } from "../lib/render";
import { EditorSession } from "../domain/EditorSession";
import type { BasicBooleanMode } from "../lib/boolean";
import type { CollaborationStatus } from "../types/collaboration";
import { CollaborationClient } from "../infra/CollaborationClient";
import { FigmaCloudClient } from "../infra/FigmaCloudClient";

export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

interface EditorState {
  doc: FigmaDocument | null;
  activePageId: string | null;
  selectedId: string | null;
  selectedIds: string[];
  viewport: Viewport;
  fileName: string;
  canUndo: boolean;
  canRedo: boolean;
  isDirty: boolean;
  tool: DesignTool;
  workspaceMode: WorkspaceMode;
  statusMessage: string;
  collaborationStatus: CollaborationStatus;
  collaborationUrl: string;
  actorId: string;
  previewMode: boolean;
  previewTargetId: string | null;
  previewHistory: string[];
  extraFiles: Record<string, Uint8Array>;

  loadDoc: (doc: FigmaDocument, fileName: string, extraFiles?: Record<string, Uint8Array>) => void;
  unload: () => void;
  markSaved: () => void;
  setStatusMessage: (message: string) => void;
  connectCollaboration: (url?: string) => void;
  disconnectCollaboration: () => void;
  importFromFigmaCloud: (fileKey: string) => Promise<void>;
  select: (id: string | null, additive?: boolean) => void;
  setSelection: (ids: string[]) => void;
  setActivePage: (id: string) => void;
  setTool: (tool: DesignTool) => void;
  setWorkspaceMode: (mode: WorkspaceMode) => void;
  updateNode: (id: string, patch: Partial<FigmaNode>) => void;
  updateTokens: (tokens: DesignToken[]) => void;
  addPage: () => void;
  setPrototypeInteraction: (interaction: PrototypeInteraction) => void;
  clearPrototypeInteraction: (nodeId: string) => void;
  addChild: (parentId: string, type: FigmaNodeType) => string | null;
  addNodeAt: (type: FigmaNodeType, x: number, y: number) => string | null;
  addPathAt: (points: PathPoint[], closed: boolean) => string | null;
  addMediaAsset: (asset: MediaAsset, bytes: Uint8Array) => string | null;
  combineSelection: (mode: BasicBooleanMode) => void;
  deleteNode: (id: string) => void;
  deleteNodes: (ids: string[]) => void;
  duplicateNode: (id: string) => void;
  duplicateSelection: () => void;
  startMove: (id: string) => void;
  moveNode: (id: string, dx: number, dy: number) => void;
  moveSelection: (dx: number, dy: number) => void;
  resizeNode: (id: string, width: number, height: number, position?: { x?: number; y?: number }) => void;
  alignSelection: (axis: "horizontal" | "vertical", mode: "MIN" | "CENTER" | "MAX" | "DISTRIBUTE") => void;
  arrangeNode: (id: string) => void;
  groupSelection: () => void;
  ungroupNode: (id: string) => void;
  makeComponent: (id: string) => void;
  createInstance: (id: string) => void;
  detachInstance: (id: string) => void;
  reorderNode: (id: string, direction: -1 | 1) => void;
  setViewport: (viewport: Viewport) => void;
  zoomBy: (factor: number, cx: number, cy: number) => void;
  fitToContent: () => void;
  recenter: () => void;
  undo: () => void;
  redo: () => void;
  setPreviewMode: (enabled: boolean) => void;
  setPreviewTarget: (id: string | null) => void;
  goPreviewBack: () => void;
}

const session = new EditorSession();
const collaborationClient = new CollaborationClient();
const figmaCloudClient = new FigmaCloudClient();
const actorId = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `actor-${Math.random().toString(36).slice(2)}`;
let applyingRemote = false;

function computePageBounds(page: FigmaNode): { x: number; y: number; width: number; height: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const child of page.children ?? []) {
    const bounds = getNodeBounds(child);
    minX = Math.min(minX, bounds.x);
    minY = Math.min(minY, bounds.y);
    maxX = Math.max(maxX, bounds.x + bounds.width);
    maxY = Math.max(maxY, bounds.y + bounds.height);
  }
  if (minX === Infinity) return { x: 0, y: 0, width: 960, height: 640 };
  return { x: minX, y: minY, width: Math.max(maxX - minX, 1), height: Math.max(maxY - minY, 1) };
}

function pageViewport(page: FigmaNode): Viewport {
  const bounds = computePageBounds(page);
  const vw = 1000;
  const vh = 700;
  const zoom = Math.max(0.05, Math.min(1, Math.min(vw / bounds.width, vh / bounds.height)));
  return {
    x: (vw - bounds.width * zoom) / 2 - bounds.x * zoom,
    y: (vh - bounds.height * zoom) / 2 - bounds.y * zoom,
    zoom,
  };
}

function toolLabel(tool: DesignTool): string {
  const labels: Record<DesignTool, string> = {
    SELECT: "선택 도구",
    FRAME: "프레임 도구",
    RECTANGLE: "사각형 도구",
    ELLIPSE: "타원 도구",
    TEXT: "텍스트 도구",
    PEN: "Pen 도구",
  };
  return labels[tool];
}

export const useEditorStore = create<EditorState>((set, get) => {
  function publish(overrides: Partial<EditorState> = {}, sync = true): void {
    set({
      doc: session.document,
      canUndo: session.canUndo,
      canRedo: session.canRedo,
      ...overrides,
    });
    if (sync && !applyingRemote && get().collaborationStatus === "CONNECTED" && session.document) collaborationClient.send(session.document);
  }

  function mutationMessage(nodeId: string | null, action: string): string {
    const node = nodeId && session.document ? findNode(session.document.document, nodeId) : null;
    return node ? `${node.name || node.type} ${action}` : action;
  }

  function insertionParent(): FigmaNode | null {
    const state = get();
    if (!session.document || !state.activePageId) return null;
    const page = findNode(session.document.document, state.activePageId);
    if (!page) return null;
    const selected = state.selectedId ? findNode(session.document.document, state.selectedId) : null;
    return selected && isContainerNode(selected) ? selected : page;
  }

  return {
    doc: null,
    activePageId: null,
    selectedId: null,
    selectedIds: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    fileName: "새 디자인.fig",
    canUndo: false,
    canRedo: false,
    isDirty: false,
    tool: "SELECT",
    workspaceMode: "DESIGN",
    statusMessage: "새 디자인을 시작하거나 .fig 파일을 열어보세요.",
    collaborationStatus: "DISCONNECTED",
    collaborationUrl: import.meta.env.VITE_COLLAB_WS_URL ?? "ws://localhost:8787",
    actorId,
    previewMode: false,
    previewTargetId: null,
    previewHistory: [],
    extraFiles: {},

    loadDoc: (doc, fileName, extraFiles = {}) => {
      const opened = session.open(doc);
      const page = firstPage(opened.document);
      publish({
        fileName,
        activePageId: page?.id ?? null,
        selectedId: null,
        selectedIds: [],
        viewport: page ? pageViewport(page) : { x: 0, y: 0, zoom: 1 },
        isDirty: false,
        tool: "SELECT",
        workspaceMode: "DESIGN",
        statusMessage: `${fileName} 준비됨`,
        previewMode: false,
        previewTargetId: page?.id ?? null,
        previewHistory: [],
        extraFiles,
      });
    },

    unload: () => {
      session.close();
      publish({
        activePageId: null,
        selectedId: null,
        selectedIds: [],
        viewport: { x: 0, y: 0, zoom: 1 },
        fileName: "새 디자인.fig",
        isDirty: false,
        tool: "SELECT",
        workspaceMode: "DESIGN",
        statusMessage: "새 디자인을 시작하거나 .fig 파일을 열어보세요.",
        previewMode: false,
        previewTargetId: null,
        previewHistory: [],
        extraFiles: {},
      });
    },

    markSaved: () => set({ isDirty: false, statusMessage: "로컬 파일로 저장됨" }),

    setStatusMessage: (statusMessage) => set({ statusMessage }),

    connectCollaboration: (url = get().collaborationUrl) => {
      if (!session.document) {
        set({ statusMessage: "먼저 문서를 열어야 실시간 협업을 시작할 수 있습니다." });
        return;
      }
      set({ collaborationUrl: url, collaborationStatus: "CONNECTING", statusMessage: "실시간 협업 연결 중" });
      collaborationClient.connect(url, session.document.name || get().fileName, actorId, (remoteDocument) => {
        applyingRemote = true;
        const page = firstPage(remoteDocument.document);
        session.open(remoteDocument);
        publish({ activePageId: page?.id ?? get().activePageId, selectedId: null, selectedIds: [], statusMessage: "원격 변경 반영됨" }, false);
        applyingRemote = false;
      }, (collaborationStatus) => set({ collaborationStatus, statusMessage: collaborationStatus === "CONNECTED" ? "LIVE 협업 연결됨" : collaborationStatus === "ERROR" ? "협업 서버 연결 오류" : "협업 연결 해제됨" }));
    },

    disconnectCollaboration: () => {
      collaborationClient.disconnect();
      set({ collaborationStatus: "DISCONNECTED", statusMessage: "로컬 작업공간으로 전환됨" });
    },

    importFromFigmaCloud: async (fileKey) => {
      try {
        const remoteDocument = await figmaCloudClient.importFile(fileKey);
        get().loadDoc(remoteDocument, `${remoteDocument.name || "figma-cloud"}.fig`);
        set({ statusMessage: "Figma Cloud 파일 가져옴" });
      } catch (error) {
        set({ statusMessage: `Figma Cloud 가져오기 실패: ${(error as Error).message}` });
      }
    },

    select: (id, additive = false) => {
      const current = get().selectedIds;
      const selectedIds = id
        ? additive
          ? current.includes(id) ? current.filter((item) => item !== id) : [...current, id]
          : [id]
        : [];
      set({ selectedIds, selectedId: selectedIds[0] ?? null });
    },

    setSelection: (selectedIds) => set({ selectedIds, selectedId: selectedIds[0] ?? null }),

    setActivePage: (activePageId) => set({ activePageId, selectedId: null, selectedIds: [], statusMessage: "페이지 전환됨" }),

    setTool: (tool) => set({ tool, statusMessage: toolLabel(tool) }),

    setWorkspaceMode: (workspaceMode) => set({ workspaceMode, tool: "SELECT", statusMessage: workspaceMode === "MEDIA" ? "미디어 작업공간" : workspaceMode === "CODE" ? "코드 핸드오프 작업공간" : "디자인 작업공간" }),

    updateNode: (id, patch) => {
      const result = session.updateNode(id, patch);
      if (!result) return;
      publish({ isDirty: true, statusMessage: mutationMessage(id, "업데이트됨") });
    },

    updateTokens: (tokens) => {
      const document = session.updateDocument({ labelTokens: tokens });
      if (!document) return;
      publish({ isDirty: true, statusMessage: "디자인 토큰 업데이트됨" });
    },

    addPage: () => {
      const result = session.addPage();
      if (!result) return;
      publish({ activePageId: result.nodeId, selectedId: null, selectedIds: [], isDirty: true, statusMessage: "새 페이지 추가됨" });
    },

    setPrototypeInteraction: (interaction) => {
      const existing = session.document?.labelPrototype ?? [];
      const interactions = [...existing.filter((item) => item.nodeId !== interaction.nodeId), interaction];
      const document = session.updateDocument({ labelPrototype: interactions });
      if (!document) return;
      publish({ isDirty: true, statusMessage: "프로토타입 연결 저장됨" });
    },

    clearPrototypeInteraction: (nodeId) => {
      const interactions = (session.document?.labelPrototype ?? []).filter((item) => item.nodeId !== nodeId);
      const document = session.updateDocument({ labelPrototype: interactions });
      if (!document) return;
      publish({ isDirty: true, statusMessage: "프로토타입 연결 제거됨" });
    },

    addChild: (parentId, type) => {
      const result = session.addChild(parentId, type);
      if (!result) return null;
      publish({ selectedId: result.nodeId, selectedIds: result.nodeId ? [result.nodeId] : [], isDirty: true, statusMessage: mutationMessage(result.nodeId, "추가됨") });
      return result.nodeId;
    },

    addNodeAt: (type, x, y) => {
      const parent = insertionParent();
      if (!parent) return null;
      let localX = x;
      let localY = y;
      const state = get();
      const page = session.document && state.activePageId ? findNode(session.document.document, state.activePageId) : null;
      if (page && parent.id !== page.id) {
        const parentWorld = getWorldTransformOf(page, parent.id ?? "") ?? identity();
        [localX, localY] = apply(invert(parentWorld), x, y);
      }
      const result = session.addChild(parent.id!, type, { x: Math.round(localX), y: Math.round(localY) });
      if (!result) return null;
      publish({ selectedId: result.nodeId, selectedIds: result.nodeId ? [result.nodeId] : [], isDirty: true, statusMessage: mutationMessage(result.nodeId, "추가됨") });
      return result.nodeId;
    },

    addPathAt: (points, closed) => {
      const parent = insertionParent();
      if (!parent || points.length < 2) return null;
      const state = get();
      const page = session.document && state.activePageId ? findNode(session.document.document, state.activePageId) : null;
      let localPoints = points;
      if (page && parent.id !== page.id) {
        const parentWorld = getWorldTransformOf(page, parent.id ?? "") ?? identity();
        const inverse = invert(parentWorld);
        localPoints = points.map((point) => {
          const [x, y] = apply(inverse, point.x, point.y);
          return { ...point, x, y };
        });
      }
      const result = session.addPath(parent.id!, localPoints, closed);
      if (!result) return null;
      publish({ selectedId: result.nodeId, selectedIds: result.nodeId ? [result.nodeId] : [], isDirty: true, statusMessage: closed ? "닫힌 Path 생성됨" : "열린 Path 생성됨" });
      return result.nodeId;
    },

    addMediaAsset: (asset, bytes) => {
      const parent = insertionParent();
      if (!parent) return null;
      const result = session.addMedia(parent.id!, asset);
      if (!result) return null;
      const extraFiles = { ...get().extraFiles, [asset.path]: bytes };
      publish({ selectedId: result.nodeId, selectedIds: result.nodeId ? [result.nodeId] : [], extraFiles, isDirty: true, statusMessage: `${asset.originalName} 미디어 배치됨` });
      if (typeof window !== "undefined") window.dispatchEvent(new Event("labelstudio:asset-added"));
      return result.nodeId;
    },

    combineSelection: (mode) => {
      const result = session.combineNodes(get().selectedIds, mode);
      if (!result) {
        set({ statusMessage: "Union/Subtract는 같은 부모의 사각형·타원·닫힌 Path 두 개만 지원합니다." });
        return;
      }
      publish({ selectedId: result.nodeId, selectedIds: result.nodeId ? [result.nodeId] : [], isDirty: true, statusMessage: mode === "UNION" ? "Union Path 생성됨" : "Subtract Path 생성됨" });
    },

    deleteNode: (id) => {
      const result = session.deleteNode(id);
      if (!result) return;
      publish({ selectedId: null, selectedIds: [], isDirty: true, statusMessage: "선택한 레이어 삭제됨" });
    },

    deleteNodes: (ids) => {
      const result = session.deleteNodes(ids);
      if (!result) return;
      publish({ selectedId: null, selectedIds: [], isDirty: true, statusMessage: `${ids.length}개 레이어 삭제됨` });
    },

    duplicateNode: (id) => {
      const result = session.duplicateNode(id);
      if (!result) return;
      publish({ selectedId: result.nodeId, selectedIds: result.nodeId ? [result.nodeId] : [], isDirty: true, statusMessage: mutationMessage(result.nodeId, "복제됨") });
    },

    duplicateSelection: () => {
      const ids = get().selectedIds;
      const result = session.duplicateNodes(ids);
      if (!result) return;
      publish({ selectedId: result.nodeId, selectedIds: result.nodeId ? [result.nodeId] : [], isDirty: true, statusMessage: `${ids.length}개 레이어 복제됨` });
    },

    startMove: () => {
      session.beginTransform();
    },

    moveNode: (id, dx, dy) => {
      const result = session.moveNode(id, dx, dy);
      if (!result) return;
      publish({ isDirty: true, statusMessage: "레이어 이동 중" });
    },

    moveSelection: (dx, dy) => {
      const ids = get().selectedIds;
      const result = session.moveNodes(ids, dx, dy);
      if (!result) return;
      publish({ isDirty: true, statusMessage: ids.length > 1 ? `${ids.length}개 레이어 이동 중` : "레이어 이동 중" });
    },

    resizeNode: (id, width, height, position) => {
      const result = session.resizeNode(id, width, height, position);
      if (!result) return;
      publish({ isDirty: true, statusMessage: "레이어 크기 변경됨" });
    },

    alignSelection: (axis, mode) => {
      const ids = get().selectedIds;
      const result = session.alignNodes(ids, axis, mode);
      if (!result) return;
      publish({ isDirty: true, statusMessage: "선택 영역 정렬됨" });
    },

    arrangeNode: (id) => {
      const result = session.arrangeNode(id);
      if (!result) return;
      publish({ isDirty: true, statusMessage: "Auto Layout 계산됨" });
    },

    groupSelection: () => {
      const result = session.groupNodes(get().selectedIds);
      if (!result) return;
      publish({ selectedId: result.nodeId, selectedIds: result.nodeId ? [result.nodeId] : [], isDirty: true, statusMessage: "선택 레이어 그룹화됨" });
    },

    ungroupNode: (id) => {
      const result = session.ungroupNode(id);
      if (!result) return;
      publish({ selectedId: result.nodeId, selectedIds: result.nodeId ? [result.nodeId] : [], isDirty: true, statusMessage: "그룹 해제됨" });
    },

    makeComponent: (id) => {
      const result = session.makeComponent(id);
      if (!result) return;
      publish({ selectedId: id, selectedIds: [id], isDirty: true, statusMessage: "로컬 컴포넌트 생성됨" });
    },

    createInstance: (id) => {
      const result = session.createInstance(id);
      if (!result) return;
      publish({ selectedId: result.nodeId, selectedIds: result.nodeId ? [result.nodeId] : [], isDirty: true, statusMessage: "컴포넌트 인스턴스 생성됨" });
    },

    detachInstance: (id) => {
      const result = session.detachInstance(id);
      if (!result) return;
      publish({ selectedId: id, selectedIds: [id], isDirty: true, statusMessage: "인스턴스 연결 해제됨" });
    },

    reorderNode: (id, direction) => {
      const result = session.reorderNode(id, direction);
      if (!result) return;
      publish({ isDirty: true, statusMessage: "레이어 순서 변경됨" });
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
      if (!session.document || !state.activePageId) return;
      const page = findNode(session.document.document, state.activePageId);
      if (!page) return;
      const bounds = computePageBounds(page);
      const canvas = document.querySelector<HTMLCanvasElement>("canvas[data-editor-canvas]");
      const vw = canvas?.clientWidth ?? 1000;
      const vh = canvas?.clientHeight ?? 700;
      const pad = 64;
      const zoom = Math.max(0.05, Math.min(1, Math.min((vw - pad * 2) / bounds.width, (vh - pad * 2) / bounds.height)));
      const m = multiply(translation(vw / 2, vh / 2), scaling(zoom, zoom));
      const [centerX, centerY] = apply(m, -(bounds.x + bounds.width / 2), -(bounds.y + bounds.height / 2));
      set({ viewport: { x: centerX + bounds.x * zoom, y: centerY + bounds.y * zoom, zoom } });
    },

    recenter: () => set({ viewport: { x: 0, y: 0, zoom: 1 } }),

    undo: () => {
      const document = session.undo();
      if (!document) return;
      const selectedIds = get().selectedIds.filter((id) => Boolean(findNode(document.document, id)));
      publish({ selectedId: selectedIds[0] ?? null, selectedIds, isDirty: true, statusMessage: "실행 취소됨" });
    },

    redo: () => {
      const document = session.redo();
      if (!document) return;
      const selectedIds = get().selectedIds.filter((id) => Boolean(findNode(document.document, id)));
      publish({ selectedId: selectedIds[0] ?? null, selectedIds, isDirty: true, statusMessage: "다시 실행됨" });
    },

    setPreviewMode: (previewMode) => set({ previewMode, previewTargetId: previewMode ? get().activePageId : null, previewHistory: [] }),

    setPreviewTarget: (previewTargetId) => {
      const current = get().previewTargetId;
      if (!previewTargetId || previewTargetId === current) return;
      set({ previewTargetId, previewHistory: current ? [...get().previewHistory, current] : get().previewHistory });
    },

    goPreviewBack: () => {
      const history = [...get().previewHistory];
      const previous = history.pop();
      if (!previous) return;
      set({ previewTargetId: previous, previewHistory: history });
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
