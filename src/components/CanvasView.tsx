import { useCallback, useEffect, useRef, useState } from "react";
import { useEditorStore } from "../store/editor";
import { findNode } from "../lib/figma";
import { hitTestNodeAt, renderScene } from "../lib/render";
import { getNodeBounds } from "../types/figma";

interface DragState {
  mode: "pan" | "move";
  lastX: number;
  lastY: number;
  targetId: string | null;
}

export function CanvasView() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const hoverRef = useRef<string | null>(null);
  const dragRef = useRef<DragState | null>(null);

  const doc = useEditorStore((s) => s.doc);
  const activePageId = useEditorStore((s) => s.activePageId);
  const selectedId = useEditorStore((s) => s.selectedId);
  const viewport = useEditorStore((s) => s.viewport);
  const select = useEditorStore((s) => s.select);
  const setViewport = useEditorStore((s) => s.setViewport);
  const moveNode = useEditorStore((s) => s.moveNode);
  const startMove = useEditorStore((s) => s.startMove);
  const zoomBy = useEditorStore((s) => s.zoomBy);

  hoverRef.current = hoverId;

  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const page = doc && activePageId ? findNode(doc.document, activePageId) : null;
    const dpr = window.devicePixelRatio || 1;
    renderScene(ctx, page, canvas.width, canvas.height, {
      viewport,
      selectedId,
      hoverId: hoverRef.current,
      dpr,
    });
  }, [doc, activePageId, selectedId, viewport]);

  useEffect(() => {
    render();
  });

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
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  const toLocal = useCallback(
    (clientX: number, clientY: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: 0, y: 0 };
      const rect = canvas.getBoundingClientRect();
      return { x: clientX - rect.left, y: clientY - rect.top };
    },
    [],
  );

  const hitTest = useCallback(
    (x: number, y: number): string | null => {
      const state = useEditorStore.getState();
      if (!state.doc || !state.activePageId) return null;
      const page = findNode(state.doc.document, state.activePageId);
      if (!page) return null;
      return hitTestNodeAt(page, x, y, state.viewport);
    },
    [],
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.setPointerCapture(e.pointerId);
      const { x, y } = toLocal(e.clientX, e.clientY);
      const isPanIntent = e.button === 1 || e.button === 2 || (e.shiftKey && e.button === 0);
      if (isPanIntent) {
        dragRef.current = { mode: "pan", lastX: x, lastY: y, targetId: null };
        canvas.style.cursor = "grabbing";
        return;
      }
      const id = hitTest(x, y);
      if (id) {
        select(id);
        startMove(id);
        dragRef.current = { mode: "move", lastX: x, lastY: y, targetId: id };
      } else {
        select(null);
        dragRef.current = { mode: "pan", lastX: x, lastY: y, targetId: null };
        canvas.style.cursor = "grabbing";
      }
    },
    [hitTest, select, startMove, toLocal],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const { x, y } = toLocal(e.clientX, e.clientY);
      const drag = dragRef.current;
      if (drag) {
        const dx = x - drag.lastX;
        const dy = y - drag.lastY;
        drag.lastX = x;
        drag.lastY = y;
        if (drag.mode === "pan") {
          const state = useEditorStore.getState();
          setViewport({ ...state.viewport, x: state.viewport.x + dx, y: state.viewport.y + dy });
        } else if (drag.mode === "move" && drag.targetId) {
          const zoom = useEditorStore.getState().viewport.zoom;
          moveNode(drag.targetId, dx / zoom, dy / zoom);
        }
        return;
      }
      const id = hitTest(x, y);
      if (id !== hoverRef.current) setHoverId(id);
    },
    [hitTest, moveNode, setViewport, toLocal],
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (canvas) canvas.style.cursor = "default";
      dragRef.current = null;
      void e;
    },
    [],
  );

  const onPointerLeave = useCallback(() => {
    setHoverId(null);
  }, []);

  const onWheel = useCallback(
    (e: React.WheelEvent<HTMLCanvasElement>) => {
      const { x, y } = toLocal(e.clientX, e.clientY);
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
        zoomBy(factor, x, y);
      } else {
        const state = useEditorStore.getState();
        setViewport({ ...state.viewport, x: state.viewport.x - e.deltaX, y: state.viewport.y - e.deltaY });
      }
    },
    [setViewport, toLocal, zoomBy],
  );

  const onDoubleClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const state = useEditorStore.getState();
      const { x, y } = toLocal(e.clientX, e.clientY);
      const id = hitTest(x, y);
      if (id) {
        const node = findNode(state.doc!.document, id);
        const bounds = getNodeBounds(node!);
        const { viewport } = state;
        const zoom = Math.max(0.05, Math.min(8, viewport.zoom * 2));
        setViewport({
          zoom,
          x: x - (bounds.x + bounds.width / 2) * zoom,
          y: y - (bounds.y + bounds.height / 2) * zoom,
        });
      }
    },
    [hitTest, setViewport, toLocal],
  );

  const onContextMenu = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    e.preventDefault();
  }, []);

  return (
    <div className="canvas-wrap">
      <canvas
        ref={canvasRef}
        data-editor-canvas
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerLeave}
        onWheel={onWheel}
        onDoubleClick={onDoubleClick}
        onContextMenu={onContextMenu}
      />
    </div>
  );
}
