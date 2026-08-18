import { useCallback, useEffect, useRef, useState } from "react";
import { Toolbar } from "./components/Toolbar";
import { LayersPanel } from "./components/LayersPanel";
import { CanvasView } from "./components/CanvasView";
import { Inspector } from "./components/Inspector";
import { PreviewView } from "./components/PreviewView";
import { MediaPanel } from "./components/MediaPanel";
import { CodeHandoffView } from "./components/CodeHandoffView";
import { useEditorStore } from "./store/editor";
import { parseFigBuffer } from "./lib/zip";
import { createBlankDocument, createNewDocument } from "./lib/figma";
import type { DesignTool } from "./types/figma";

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

function WelcomeView({ onOpenFile }: { onOpenFile: () => void }) {
  const loadDoc = useEditorStore((state) => state.loadDoc);

  const startBlank = () => {
    const { doc, fileName } = createBlankDocument();
    loadDoc(doc, fileName);
  };

  const openSample = () => {
    const { doc, fileName } = createNewDocument("labelstudio-sample.fig");
    loadDoc(doc, fileName);
  };

  return (
    <section className="welcome-view">
      <div className="welcome-copy">
        <p className="eyebrow">LABELSTUDIO / CODE-FIRST DESIGN / 01</p>
        <h1>코딩, 디자인,<br />미디어 편집과 보정까지</h1>
        <p className="welcome-description">
          그 모든 것을 한 곳에서.<br />당신을 위한, 당신의 곁에 — LabelStudio.
        </p>
        <div className="welcome-actions">
          <button className="btn btn-primary btn-large" onClick={startBlank}>
            새 보드 시작
            <span className="shortcut">Enter</span>
          </button>
          <button className="btn btn-quiet btn-large" onClick={onOpenFile}>
            .fig 열기
            <span className="shortcut">Ctrl O</span>
          </button>
        </div>
      </div>

      <div className="welcome-grid">
        <button className="welcome-card" onClick={startBlank}>
          <span className="card-index">01</span>
          <span className="card-title">빈 보드</span>
          <span className="card-description">프레임과 요소를 원하는 순서로 쌓아 나갑니다.</span>
          <span className="card-action">새 작업공간 만들기 →</span>
        </button>
        <button className="welcome-card" onClick={openSample}>
          <span className="card-index">02</span>
          <span className="card-title">구조 샘플</span>
          <span className="card-description">페이지, 프레임, 텍스트의 관계를 살펴봅니다.</span>
          <span className="card-action">샘플 둘러보기 →</span>
        </button>
        <div className="welcome-card welcome-card-note">
          <span className="card-index">03</span>
          <span className="card-title">코드 핸드오프</span>
          <span className="card-description">HTML, React, CSS, 토큰과 readiness 리포트를 함께 내보냅니다.</span>
          <span className="card-status">오프라인 우선 · 데이터는 로컬에만</span>
        </div>
      </div>
    </section>
  );
}

export default function App() {
  const doc = useEditorStore((state) => state.doc);
  const selectedId = useEditorStore((state) => state.selectedId);
  const selectedIds = useEditorStore((state) => state.selectedIds);
  const deleteNodes = useEditorStore((state) => state.deleteNodes);
  const duplicateNode = useEditorStore((state) => state.duplicateNode);
  const duplicateSelection = useEditorStore((state) => state.duplicateSelection);
  const moveSelection = useEditorStore((state) => state.moveSelection);
  const undo = useEditorStore((state) => state.undo);
  const redo = useEditorStore((state) => state.redo);
  const loadDoc = useEditorStore((state) => state.loadDoc);
  const setTool = useEditorStore((state) => state.setTool);
  const tool = useEditorStore((state) => state.tool);
  const setStatusMessage = useEditorStore((state) => state.setStatusMessage);
  const statusMessage = useEditorStore((state) => state.statusMessage);
  const previewMode = useEditorStore((state) => state.previewMode);
  const workspaceMode = useEditorStore((state) => state.workspaceMode);
  const setWorkspaceMode = useEditorStore((state) => state.setWorkspaceMode);
  const setPreviewMode = useEditorStore((state) => state.setPreviewMode);

  const [dragging, setDragging] = useState(false);
  const [layersOpen, setLayersOpen] = useState(() => window.innerWidth > 900);
  const [inspectorOpen, setInspectorOpen] = useState(() => window.innerWidth > 900);
  const dragDepth = useRef(0);
  const loadFileRef = useRef<(file: File) => void>(() => undefined);
  const welcomeInputRef = useRef<HTMLInputElement>(null);

  const openFile = useCallback(
    async (file: File) => {
      if (!file.name.toLowerCase().endsWith(".fig")) {
        setStatusMessage(".fig 파일만 열 수 있습니다.");
        return;
      }
      try {
        const buffer = await file.arrayBuffer();
        const { doc: parsed, files } = parseFigBuffer(buffer);
        loadDoc(parsed, file.name, files);
      } catch (error) {
        setStatusMessage(`파일을 열 수 없습니다: ${(error as Error).message}`);
      }
    },
    [loadDoc, setStatusMessage],
  );

  useEffect(() => {
    loadFileRef.current = (file) => void openFile(file);
  }, [openFile]);

  const onKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) return;
      const mod = event.ctrlKey || event.metaKey;

      if (previewMode) {
        if (event.key === "Escape") {
          event.preventDefault();
          setPreviewMode(false);
        }
        return;
      }

      if (!doc && event.key === "Enter") {
        event.preventDefault();
        const { doc: blankDoc, fileName } = createBlankDocument();
        loadDoc(blankDoc, fileName);
        return;
      }

      if (tool === "PEN" && event.key === "Enter") {
        event.preventDefault();
        window.dispatchEvent(new Event("labelstudio:finish-path"));
        return;
      }

      if (mod && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }
      if (mod && event.key.toLowerCase() === "y") {
        event.preventDefault();
        redo();
        return;
      }
      if (mod && event.key.toLowerCase() === "d") {
        event.preventDefault();
        if (selectedIds.length > 0) duplicateSelection();
        else if (selectedId) duplicateNode(selectedId);
        return;
      }
      if ((event.key === "Delete" || event.key === "Backspace") && selectedId) {
        event.preventDefault();
        deleteNodes(selectedIds.length > 0 ? selectedIds : [selectedId]);
        return;
      }
      if (selectedId && event.key.startsWith("Arrow")) {
        event.preventDefault();
        const step = event.shiftKey ? 10 : 1;
        const delta =
          event.key === "ArrowLeft"
            ? { x: -step, y: 0 }
            : event.key === "ArrowRight"
              ? { x: step, y: 0 }
              : event.key === "ArrowUp"
                ? { x: 0, y: -step }
                : { x: 0, y: step };
        moveSelection(delta.x, delta.y);
        return;
      }

      if (!mod && event.key.toLowerCase() === "d") {
        setWorkspaceMode("DESIGN");
        return;
      }
      if (!mod && event.key.toLowerCase() === "m") {
        setWorkspaceMode("MEDIA");
        return;
      }
      if (!mod && event.key.toLowerCase() === "c") {
        setWorkspaceMode("CODE");
        return;
      }

      const tools: Record<string, DesignTool> = {
        v: "SELECT",
        f: "FRAME",
        r: "RECTANGLE",
        o: "ELLIPSE",
        t: "TEXT",
        p: "PEN",
      };
      const nextTool = tools[event.key.toLowerCase()];
      if (!mod && nextTool) setTool(nextTool);
      if (event.key === "Escape") {
        window.dispatchEvent(new Event("labelstudio:cancel-path"));
        if (previewMode) setPreviewMode(false);
        setTool("SELECT");
      }
    },
    [deleteNodes, doc, duplicateNode, duplicateSelection, loadDoc, moveSelection, previewMode, redo, selectedId, selectedIds, setPreviewMode, setTool, setWorkspaceMode, tool, undo],
  );

  useEffect(() => {
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onKeyDown]);

  const onDrop = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    const file = Array.from(event.dataTransfer.files).find((item) => item.name.toLowerCase().endsWith(".fig"));
    if (file) void loadFileRef.current(file);
    else if (event.dataTransfer.files.length > 0) setStatusMessage(".fig 파일만 열 수 있습니다.");
  }, [setStatusMessage]);

  const onDragEnter = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    dragDepth.current += 1;
    setDragging(true);
  }, []);

  const onDragLeave = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    dragDepth.current -= 1;
    if (dragDepth.current <= 0) {
      dragDepth.current = 0;
      setDragging(false);
    }
  }, []);

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
  }, []);

  return (
    <div className="app" onDrop={onDrop} onDragEnter={onDragEnter} onDragLeave={onDragLeave} onDragOver={onDragOver}>
      <Toolbar
        onOpenFile={(file) => void openFile(file)}
        onToggleLayers={() => { setLayersOpen((open) => !open); setInspectorOpen(false); }}
        onToggleInspector={() => { setInspectorOpen((open) => !open); setLayersOpen(false); }}
        onTogglePreview={() => setPreviewMode(!previewMode)}
      />
      <main className={`main${doc ? " is-editor" : " is-welcome"}${layersOpen ? " layers-open" : ""}${inspectorOpen ? " inspector-open" : ""}`}>
        {doc && !previewMode && layersOpen && (workspaceMode === "MEDIA" ? <MediaPanel /> : <LayersPanel />)}
        {doc ? previewMode ? <PreviewView /> : workspaceMode === "CODE" ? <CodeHandoffView /> : <CanvasView /> : <WelcomeView onOpenFile={() => welcomeInputRef.current?.click()} />}
        {doc && !previewMode && inspectorOpen && <Inspector />}
      </main>
      <input
        ref={welcomeInputRef}
        className="visually-hidden"
        type="file"
        accept=".fig,application/zip"
        aria-label="FIG 파일 열기"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void openFile(file);
          event.target.value = "";
        }}
      />
      {doc && <div className="workspace-status" role="status">{statusMessage}</div>}
      {dragging && (
        <div className="drop-overlay" role="status">
          <div className="drop-card">
            <span className="drop-mark">+</span>
            <strong>디자인 파일을 놓으세요</strong>
            <span>.fig 파일을 로컬 작업공간으로 가져옵니다.</span>
          </div>
        </div>
      )}
    </div>
  );
}
