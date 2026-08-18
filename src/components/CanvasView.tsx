import { useCallback, useEffect, useRef, useState } from "react";
import type { DesignTool, FigmaNode, FigmaNodeType } from "../types/figma";
import type { PathPoint } from "../types/design";
import { useEditorStore } from "../store/editor";
import { findNode, findParent } from "../lib/figma";
import { getWorldTransformOf, hitTestNodeAt, renderScene, selectNodesInRect } from "../lib/render";
import { getNodeBounds } from "../types/figma";
import { apply, identity, invert } from "../lib/matrix";

interface DragState {
  mode: "pan" | "move" | "marquee" | "resize" | "pen";
  lastX: number;
  lastY: number;
  startX: number;
  startY: number;
  targetId: string | null;
  targetIds: string[];
  corner?: "nw" | "ne" | "se" | "sw";
  additive?: boolean;
  startWidth?: number;
  startHeight?: number;
  startNodeX?: number;
  startNodeY?: number;
  penIndex?: number;
}

interface MarqueeRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const TOOL_NODE_TYPES: Partial<Record<DesignTool, FigmaNodeType>> = {
  FRAME: "FRAME",
  RECTANGLE: "RECTANGLE",
  ELLIPSE: "ELLIPSE",
  TEXT: "TEXT",
};

function toolName(tool: DesignTool): string {
  return {
    SELECT: "선택",
    FRAME: "프레임 배치",
    RECTANGLE: "사각형 배치",
    ELLIPSE: "타원 배치",
    TEXT: "텍스트 배치",
    PEN: "Pen Path",
  }[tool];
}

function resizeCornerAt(node: FigmaNode, x: number, y: number, viewport: { x: number; y: number; zoom: number }): DragState["corner"] {
  const bounds = getNodeBounds(node);
  const left = viewport.x + bounds.x * viewport.zoom;
  const top = viewport.y + bounds.y * viewport.zoom;
  const right = left + bounds.width * viewport.zoom;
  const bottom = top + bounds.height * viewport.zoom;
  const threshold = 11;
  const nearLeft = Math.abs(x - left) <= threshold;
  const nearRight = Math.abs(x - right) <= threshold;
  const nearTop = Math.abs(y - top) <= threshold;
  const nearBottom = Math.abs(y - bottom) <= threshold;
  if (nearLeft && nearTop) return "nw";
  if (nearRight && nearTop) return "ne";
  if (nearRight && nearBottom) return "se";
  if (nearLeft && nearBottom) return "sw";
  return undefined;
}

function rectFromPoints(startX: number, startY: number, x: number, y: number): MarqueeRect {
  return { x: Math.min(startX, x), y: Math.min(startY, y), width: Math.abs(x - startX), height: Math.abs(y - startY) };
}

export function CanvasView() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const [marquee, setMarquee] = useState<MarqueeRect | null>(null);
  const [pathDraft, setPathDraft] = useState<PathPoint[]>([]);

  const doc = useEditorStore((state) => state.doc);
  const activePageId = useEditorStore((state) => state.activePageId);
  const selectedId = useEditorStore((state) => state.selectedId);
  const selectedIds = useEditorStore((state) => state.selectedIds);
  const extraFiles = useEditorStore((state) => state.extraFiles);
  const viewport = useEditorStore((state) => state.viewport);
  const tool = useEditorStore((state) => state.tool);
  const select = useEditorStore((state) => state.select);
  const setSelection = useEditorStore((state) => state.setSelection);
  const setViewport = useEditorStore((state) => state.setViewport);
  const moveNode = useEditorStore((state) => state.moveNode);
  const moveSelection = useEditorStore((state) => state.moveSelection);
  const startMove = useEditorStore((state) => state.startMove);
  const resizeNode = useEditorStore((state) => state.resizeNode);
  const zoomBy = useEditorStore((state) => state.zoomBy);
  const setTool = useEditorStore((state) => state.setTool);
  const addNodeAt = useEditorStore((state) => state.addNodeAt);
  const addPathAt = useEditorStore((state) => state.addPathAt);

  const finishPath = useCallback((closed: boolean) => {
    if (pathDraft.length >= 2) addPathAt(pathDraft, closed);
    setPathDraft([]);
    dragRef.current = null;
    setTool("SELECT");
  }, [addPathAt, pathDraft, setTool]);

  useEffect(() => {
    const cancel = () => {
      setPathDraft([]);
      dragRef.current = null;
    };
    const finish = () => finishPath(false);
    window.addEventListener("labelstudio:cancel-path", cancel);
    window.addEventListener("labelstudio:finish-path", finish);
    return () => {
      window.removeEventListener("labelstudio:cancel-path", cancel);
      window.removeEventListener("labelstudio:finish-path", finish);
    };
  }, [finishPath]);

  useEffect(() => {
    if (tool !== "PEN" && pathDraft.length > 0) setPathDraft([]);
  }, [pathDraft.length, tool]);

  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const page = doc && activePageId ? findNode(doc.document, activePageId) : null;
    renderScene(context, page, canvas.width, canvas.height, {
      viewport,
      selectedId,
      selectedIds,
      dpr: window.devicePixelRatio || 1,
      assets: extraFiles,
      onAssetLoad: () => window.dispatchEvent(new Event("labelstudio:asset-loaded")),
    });
  }, [doc, activePageId, extraFiles, selectedId, selectedIds, viewport]);

  useEffect(() => {
    const redraw = () => render();
    window.addEventListener("labelstudio:asset-loaded", redraw);
    return () => window.removeEventListener("labelstudio:asset-loaded", redraw);
  }, [render]);

  useEffect(() => {
    render();
  }, [render]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const container = canvas.parentElement;
    if (!container) return;
    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, container.clientWidth * dpr);
      canvas.height = Math.max(1, container.clientHeight * dpr);
      canvas.style.width = `${container.clientWidth}px`;
      canvas.style.height = `${container.clientHeight}px`;
      render();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    return () => observer.disconnect();
  }, [render]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas) canvas.style.cursor = tool === "SELECT" ? "default" : "crosshair";
  }, [tool]);

  const toLocal = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  }, []);

  const toWorld = useCallback((x: number, y: number) => {
    const state = useEditorStore.getState();
    return { x: (x - state.viewport.x) / state.viewport.zoom, y: (y - state.viewport.y) / state.viewport.zoom };
  }, []);

  const toLocalDelta = useCallback((id: string, dx: number, dy: number) => {
    const state = useEditorStore.getState();
    if (!state.doc || !state.activePageId) return { x: dx, y: dy };
    const page = findNode(state.doc.document, state.activePageId);
    const parent = page ? findParent(page, id)?.parent : null;
    if (!page || !parent || parent.id === page.id) return { x: dx, y: dy };
    const parentWorld = getWorldTransformOf(page, parent.id ?? "") ?? identity();
    const inverse = invert(parentWorld);
    const [originX, originY] = apply(inverse, 0, 0);
    const [targetX, targetY] = apply(inverse, dx, dy);
    return { x: targetX - originX, y: targetY - originY };
  }, []);

  const hitTest = useCallback((x: number, y: number): string | null => {
    const state = useEditorStore.getState();
    if (!state.doc || !state.activePageId) return null;
    const page = findNode(state.doc.document, state.activePageId);
    return page ? hitTestNodeAt(page, x, y, state.viewport) : null;
  }, []);

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.setPointerCapture(event.pointerId);
      const local = toLocal(event.clientX, event.clientY);
      const isPanIntent = event.button === 1 || event.button === 2 || (event.shiftKey && event.button === 0);

      if (isPanIntent) {
        dragRef.current = { mode: "pan", lastX: local.x, lastY: local.y, startX: local.x, startY: local.y, targetId: null, targetIds: [] };
        canvas.style.cursor = "grabbing";
        return;
      }

      if (tool === "PEN" && event.button === 0) {
        const world = toWorld(local.x, local.y);
        const first = pathDraft[0];
        if (first && pathDraft.length >= 3 && Math.hypot((first.x - world.x) * viewport.zoom, (first.y - world.y) * viewport.zoom) < 12) {
          finishPath(true);
          return;
        }
        const index = pathDraft.length;
        setPathDraft((current) => [...current, { x: world.x, y: world.y }]);
        dragRef.current = { mode: "pen", lastX: local.x, lastY: local.y, startX: local.x, startY: local.y, targetId: null, targetIds: [], penIndex: index };
        return;
      }

      if (tool !== "SELECT" && event.button === 0) {
        const type = TOOL_NODE_TYPES[tool];
        if (type) {
          const world = toWorld(local.x, local.y);
          addNodeAt(type, world.x, world.y);
          setTool("SELECT");
        }
        dragRef.current = null;
        return;
      }

      const state = useEditorStore.getState();
      const selectedNode = selectedIds.length === 1 && state.doc ? findNode(state.doc.document, selectedIds[0]) : null;
      const corner = selectedNode ? resizeCornerAt(selectedNode, local.x, local.y, state.viewport) : undefined;
      if (corner && event.button === 0) {
        startMove(selectedNode!.id!);
        const selectedBounds = getNodeBounds(selectedNode!);
        dragRef.current = { mode: "resize", lastX: local.x, lastY: local.y, startX: local.x, startY: local.y, targetId: selectedNode!.id!, targetIds: [selectedNode!.id!], corner, startWidth: selectedBounds.width, startHeight: selectedBounds.height, startNodeX: selectedBounds.x, startNodeY: selectedBounds.y };
        canvas.style.cursor = `${corner}-resize`;
        return;
      }

      const id = hitTest(local.x, local.y);
      if (id) {
        const wasSelected = selectedIds.includes(id);
        if (event.shiftKey) {
          if (wasSelected) {
            select(id, true);
            dragRef.current = null;
            return;
          }
          select(id, true);
        } else {
          select(id);
        }
        const targetIds = event.shiftKey ? [...new Set([...selectedIds, id])] : [id];
        startMove(id);
        dragRef.current = { mode: "move", lastX: local.x, lastY: local.y, startX: local.x, startY: local.y, targetId: id, targetIds };
      } else {
        dragRef.current = { mode: "marquee", lastX: local.x, lastY: local.y, startX: local.x, startY: local.y, targetId: null, targetIds: [], additive: event.shiftKey };
        setMarquee({ x: local.x, y: local.y, width: 0, height: 0 });
        if (!event.shiftKey) setSelection([]);
      }
    },
    [addNodeAt, finishPath, hitTest, pathDraft, select, selectedIds, setSelection, setTool, startMove, toLocal, toWorld, tool, viewport.zoom],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      const local = toLocal(event.clientX, event.clientY);
      const drag = dragRef.current;
      if (!drag) return;
      const dx = local.x - drag.lastX;
      const dy = local.y - drag.lastY;
      drag.lastX = local.x;
      drag.lastY = local.y;

      if (drag.mode === "pan") {
        const state = useEditorStore.getState();
        setViewport({ ...state.viewport, x: state.viewport.x + dx, y: state.viewport.y + dy });
      } else if (drag.mode === "marquee") {
        setMarquee(rectFromPoints(drag.startX, drag.startY, local.x, local.y));
      } else if (drag.mode === "pen" && drag.penIndex !== undefined) {
        const world = toWorld(local.x, local.y);
        const point = pathDraft[drag.penIndex];
        if (!point) return;
        const handle = { x: world.x - point.x, y: world.y - point.y };
        setPathDraft((current) => current.map((item, index) => index === drag.penIndex ? { ...item, handleOut: handle, handleIn: { x: -handle.x, y: -handle.y } } : item));
      } else if (drag.mode === "move") {
        const state = useEditorStore.getState();
        const localDelta = drag.targetId ? toLocalDelta(drag.targetId, dx / state.viewport.zoom, dy / state.viewport.zoom) : { x: dx / state.viewport.zoom, y: dy / state.viewport.zoom };
        if (drag.targetIds.length > 1) moveSelection(localDelta.x, localDelta.y);
        else if (drag.targetId) moveNode(drag.targetId, localDelta.x, localDelta.y);
      } else if (drag.mode === "resize" && drag.targetId) {
        const state = useEditorStore.getState();
        const node = state.doc ? findNode(state.doc.document, drag.targetId) : null;
        if (!node) return;
        const world = toWorld(local.x, local.y);
        const startWorld = toWorld(drag.startX, drag.startY);
        const deltaX = world.x - startWorld.x;
        const deltaY = world.y - startWorld.y;
        const minSize = 8;
        const startWidth = drag.startWidth ?? node.width ?? 0;
        const startHeight = drag.startHeight ?? node.height ?? 0;
        const startNodeX = drag.startNodeX ?? node.x ?? 0;
        const startNodeY = drag.startNodeY ?? node.y ?? 0;
        const nextWidth = Math.max(minSize, startWidth + (drag.corner?.includes("e") ? deltaX : -deltaX));
        const nextHeight = Math.max(minSize, startHeight + (drag.corner?.includes("s") ? deltaY : -deltaY));
        const nextX = drag.corner?.includes("w") ? startNodeX + (startWidth - nextWidth) : startNodeX;
        const nextY = drag.corner?.includes("n") ? startNodeY + (startHeight - nextHeight) : startNodeY;
        resizeNode(drag.targetId, nextWidth, nextHeight, { x: nextX, y: nextY });
      }
    },
    [moveNode, moveSelection, pathDraft, resizeNode, setViewport, toLocal, toLocalDelta, toWorld],
  );

  const onPointerUp = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    const drag = dragRef.current;
    if (drag?.mode === "marquee" && doc && activePageId) {
      const page = findNode(doc.document, activePageId);
      const local = toLocal(event.clientX, event.clientY);
      if (page) {
        const picked = selectNodesInRect(page, drag.startX, drag.startY, local.x - drag.startX, local.y - drag.startY, useEditorStore.getState().viewport);
        setSelection(drag.additive ? [...new Set([...selectedIds, ...picked])] : picked);
      }
    }
    if (canvas?.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    if (canvas) canvas.style.cursor = tool === "SELECT" ? "default" : "crosshair";
    dragRef.current = null;
    setMarquee(null);
  }, [activePageId, doc, selectedIds, setSelection, toLocal, tool]);

  const onWheel = useCallback(
    (event: React.WheelEvent<HTMLCanvasElement>) => {
      const local = toLocal(event.clientX, event.clientY);
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        zoomBy(event.deltaY < 0 ? 1.1 : 1 / 1.1, local.x, local.y);
        return;
      }
      const state = useEditorStore.getState();
      setViewport({ ...state.viewport, x: state.viewport.x - event.deltaX, y: state.viewport.y - event.deltaY });
    },
    [setViewport, toLocal, zoomBy],
  );

  const onDoubleClick = useCallback(
    (event: React.MouseEvent<HTMLCanvasElement>) => {
      if (tool === "PEN") {
        event.preventDefault();
        finishPath(false);
        return;
      }
      if (tool !== "SELECT") return;
      const state = useEditorStore.getState();
      if (!state.doc) return;
      const local = toLocal(event.clientX, event.clientY);
      const id = hitTest(local.x, local.y);
      if (!id) return;
      const node = findNode(state.doc.document, id);
      if (!node) return;
      const bounds = getNodeBounds(node);
      const zoom = Math.max(0.05, Math.min(8, state.viewport.zoom * 2));
      setViewport({ zoom, x: local.x - (bounds.x + bounds.width / 2) * zoom, y: local.y - (bounds.y + bounds.height / 2) * zoom });
    },
    [finishPath, hitTest, setViewport, toLocal, tool],
  );

  const selectedNode = doc && selectedId ? findNode(doc.document, selectedId) : null;
  const activePageName = activePageId && doc ? findNode(doc.document, activePageId)?.name || "페이지" : "페이지";

  return (
    <div className="canvas-wrap">
      <canvas
        ref={canvasRef}
        data-editor-canvas
        role="application"
        tabIndex={0}
        aria-label="LabelStudio 디자인 캔버스"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={onWheel}
        onDoubleClick={onDoubleClick}
        onContextMenu={(event) => event.preventDefault()}
      />
      {pathDraft.length > 0 && (
        <svg className="pen-draft" aria-hidden="true">
          <polyline points={pathDraft.map((point) => `${viewport.x + point.x * viewport.zoom},${viewport.y + point.y * viewport.zoom}`).join(" ")} />
          {pathDraft.map((point, index) => <circle key={`${point.x}-${point.y}-${index}`} cx={viewport.x + point.x * viewport.zoom} cy={viewport.y + point.y * viewport.zoom} r={index === 0 ? 6 : 4} />)}
        </svg>
      )}
      {marquee && <div className="marquee-selection" style={{ left: marquee.x, top: marquee.y, width: marquee.width, height: marquee.height }} />}
      <div className="canvas-label" aria-hidden="true"><span className="eyebrow">CANVAS</span><span>{activePageName}</span></div>
      <div className="canvas-selection-readout" aria-live="polite">
        {selectedIds.length > 1 ? `${selectedIds.length}개 레이어 선택됨` : selectedNode ? `${selectedNode.name || selectedNode.type} 선택됨` : "캔버스 준비됨"}
      </div>
      <div className="canvas-hint"><span className="tool-readout">{toolName(tool)}</span><span>{tool === "SELECT" ? "Shift 선택 · 드래그 영역 선택 · Shift + 드래그 팬" : "캔버스를 클릭해 배치"}</span></div>
    </div>
  );
}
