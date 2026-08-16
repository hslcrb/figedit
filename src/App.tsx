import { useCallback, useEffect, useRef, useState } from "react";
import { Toolbar } from "./components/Toolbar";
import { LayersPanel } from "./components/LayersPanel";
import { CanvasView } from "./components/CanvasView";
import { Inspector } from "./components/Inspector";
import { useEditorStore } from "./store/editor";
import { parseFigBuffer } from "./lib/zip";

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

export default function App() {
  const doc = useEditorStore((s) => s.doc);
  const selectedId = useEditorStore((s) => s.selectedId);
  const deleteNode = useEditorStore((s) => s.deleteNode);
  const duplicateNode = useEditorStore((s) => s.duplicateNode);
  const moveNode = useEditorStore((s) => s.moveNode);
  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);
  const loadDoc = useEditorStore((s) => s.loadDoc);
  const loadFileRef = useRef<(f: File) => void>(() => {});

  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);

  useEffect(() => {
    loadFileRef.current = async (file: File) => {
      try {
        const buffer = await file.arrayBuffer();
        const { doc: parsed, files } = parseFigBuffer(buffer);
        loadDoc(parsed, file.name, files);
      } catch (err) {
        alert(`파일을 열 수 없습니다.\n${(err as Error).message}`);
      }
    };
  }, [loadDoc]);

  const onKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (isEditableTarget(e.target)) return;
      const mod = e.ctrlKey || e.metaKey;

      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
        return;
      }
      if (mod && e.key.toLowerCase() === "d") {
        e.preventDefault();
        if (selectedId) duplicateNode(selectedId);
        return;
      }
      if ((e.key === "Delete" || e.key === "Backspace") && selectedId) {
        e.preventDefault();
        deleteNode(selectedId);
        return;
      }
      if (selectedId && (e.key.startsWith("Arrow"))) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const delta =
          e.key === "ArrowLeft" ? { x: -step, y: 0 } : e.key === "ArrowRight" ? { x: step, y: 0 } : e.key === "ArrowUp" ? { x: 0, y: -step } : { x: 0, y: step };
        moveNode(selectedId, delta.x, delta.y);
      }
    },
    [selectedId, deleteNode, duplicateNode, moveNode, undo, redo],
  );

  useEffect(() => {
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onKeyDown]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    const file = Array.from(e.dataTransfer.files).find((f) => f.name.endsWith(".fig"));
    if (file) void loadFileRef.current(file);
    else if (e.dataTransfer.files.length > 0) alert(".fig 파일만 열 수 있습니다.");
  }, []);

  const onDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragDepth.current += 1;
    setDragging(true);
  }, []);

  const onDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragDepth.current -= 1;
    if (dragDepth.current <= 0) {
      dragDepth.current = 0;
      setDragging(false);
    }
  }, []);

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  return (
    <div
      className="app"
      onDrop={onDrop}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
    >
      <Toolbar />
      <div className="main">
        <LayersPanel />
        {doc ? (
          <CanvasView />
        ) : (
          <div className="empty-state">
            <div className="empty-inner">
              <div className="empty-logo">F</div>
              <h1>FigEdit</h1>
              <p>.fig 파일을 이 영역으로 끌어다 놓거나, 아래 버튼으로 파일을 엽니다.</p>
              <button
                className="btn primary large"
                onClick={() => {
                  const input = document.createElement("input");
                  input.type = "file";
                  input.accept = ".fig,application/zip";
                  input.onchange = () => {
                    const file = input.files?.[0];
                    if (file) void loadFileRef.current(file);
                  };
                  input.click();
                }}
              >
                파일 열기
              </button>
            </div>
          </div>
        )}
        <Inspector />
      </div>
      {dragging && <div className="drop-overlay">.fig 파일을 놓아서 열기</div>}
    </div>
  );
}
