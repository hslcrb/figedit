import { useCallback, useEffect, useRef, useState } from "react";
import { useEditorStore } from "../store/editor";
import { createBlankDocument } from "../lib/figma";
import { downloadFig, serializeFigDocument } from "../lib/zip";
import { DesignExporter, downloadCanvasPng, downloadText } from "../domain/DesignExporter";
import { CodeExporter, downloadCodePackage } from "../domain/CodeExporter";

interface ToolbarProps {
  onOpenFile: (file: File) => void;
  onToggleLayers: () => void;
  onToggleInspector: () => void;
  onTogglePreview: () => void;
}

function baseName(fileName: string): string {
  return fileName.replace(/\.fig$/i, "") || "design";
}

export function Toolbar({ onOpenFile, onToggleLayers, onToggleInspector, onTogglePreview }: ToolbarProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const doc = useEditorStore((state) => state.doc);
  const fileName = useEditorStore((state) => state.fileName);
  const extraFiles = useEditorStore((state) => state.extraFiles);
  const viewport = useEditorStore((state) => state.viewport);
  const canUndo = useEditorStore((state) => state.canUndo);
  const canRedo = useEditorStore((state) => state.canRedo);
  const selectedIds = useEditorStore((state) => state.selectedIds);
  const isDirty = useEditorStore((state) => state.isDirty);
  const loadDoc = useEditorStore((state) => state.loadDoc);
  const markSaved = useEditorStore((state) => state.markSaved);
  const setStatusMessage = useEditorStore((state) => state.setStatusMessage);
  const zoomBy = useEditorStore((state) => state.zoomBy);
  const fitToContent = useEditorStore((state) => state.fitToContent);
  const undo = useEditorStore((state) => state.undo);
  const redo = useEditorStore((state) => state.redo);
  const previewMode = useEditorStore((state) => state.previewMode);
  const workspaceMode = useEditorStore((state) => state.workspaceMode);
  const setWorkspaceMode = useEditorStore((state) => state.setWorkspaceMode);
  const collaborationStatus = useEditorStore((state) => state.collaborationStatus);
  const connectCollaboration = useEditorStore((state) => state.connectCollaboration);
  const disconnectCollaboration = useEditorStore((state) => state.disconnectCollaboration);
  const importFromFigmaCloud = useEditorStore((state) => state.importFromFigmaCloud);

  const handleNew = () => {
    if (isDirty && !window.confirm("저장하지 않은 변경 사항이 있습니다. 새 보드를 열까요?")) return;
    const { doc: newDoc, fileName: newName } = createBlankDocument();
    loadDoc(newDoc, newName);
  };

  const toggleCollaboration = () => {
    if (collaborationStatus === "CONNECTED" || collaborationStatus === "CONNECTING") disconnectCollaboration();
    else connectCollaboration();
  };

  const handleCloudImport = () => {
    const fileKey = window.prompt("Figma file key를 입력하세요. 서버에 FIGMA_ACCESS_TOKEN이 설정되어 있어야 합니다.");
    if (fileKey) void importFromFigmaCloud(fileKey.trim());
  };

  const handlePick = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) onOpenFile(file);
    event.target.value = "";
  };

  const handleSave = useCallback(() => {
    if (!doc) return;
    const data = serializeFigDocument(doc, extraFiles);
    const blob = new Blob([data as BlobPart], { type: "application/zip" });
    downloadFig(blob, fileName || "새 디자인.fig");
    markSaved();
  }, [doc, extraFiles, fileName, markSaved]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (target instanceof HTMLElement && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      const mod = event.ctrlKey || event.metaKey;
      if (!mod) return;
      if (event.key.toLowerCase() === "s") {
        event.preventDefault();
        handleSave();
      }
      if (event.key.toLowerCase() === "o") {
        event.preventDefault();
        fileInputRef.current?.click();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleSave]);

  const handleExport = (format: "json" | "svg" | "png" | "code" | "report") => {
    if (!doc) return;
    const name = baseName(fileName);
    const rootId = selectedIds.length === 1 ? selectedIds[0] : useEditorStore.getState().activePageId;
    const exporter = new DesignExporter(doc, rootId);
    const codeExporter = new CodeExporter(doc, rootId, extraFiles);
    if (format === "json") downloadText(exporter.toJson(), `${name}.json`, "application/json");
    if (format === "svg") downloadText(exporter.toSvg(), `${name}.svg`, "image/svg+xml");
    if (format === "png") downloadCanvasPng(`${name}.png`);
    if (format === "code") downloadCodePackage(codeExporter.package(), `${name}-labelstudio-handoff.zip`);
    if (format === "report") downloadText(JSON.stringify(codeExporter.report(), null, 2), `${name}-handoff.json`, "application/json");
    setExportOpen(false);
    setStatusMessage(format === "code" ? "개발자 코드 패키지 내보냄" : format === "report" ? "핸드오프 리포트 내보냄" : `${format.toUpperCase()} 결과 내보냄`);
  };

  const zoomPct = Math.round(viewport.zoom * 100);
  const zoomCenter = () => {
    const canvas = document.querySelector<HTMLCanvasElement>("canvas[data-editor-canvas]");
    return { x: (canvas?.clientWidth ?? window.innerWidth) / 2, y: (canvas?.clientHeight ?? 700) / 2 };
  };

  return (
    <header className="toolbar">
      <div className="brand" aria-label="LabelStudio">
        <span className="brand-logo">L/</span>
        <span className="brand-copy">
          <strong>LabelStudio</strong>
          <small>Code-first design</small>
        </span>
      </div>

      <div className="file-context">
        <span className={`save-state${isDirty ? " is-dirty" : ""}`} aria-label={isDirty ? "저장되지 않음" : "저장됨"} />
        <span className="file-name" title={fileName}>{fileName}</span>
        <span className="file-mode">LOCAL</span>
        <button className={`collaboration-pill status-${collaborationStatus.toLowerCase()}`} onClick={toggleCollaboration} disabled={!doc} title="실시간 협업 서버 연결">{collaborationStatus === "CONNECTED" ? "LIVE" : "LOCAL"}</button>
      </div>

      <nav className="workspace-modes" aria-label="작업공간 모드">
        <button className={workspaceMode === "DESIGN" ? "is-active" : ""} aria-pressed={workspaceMode === "DESIGN"} onClick={() => setWorkspaceMode("DESIGN")}>디자인</button>
        <button className={workspaceMode === "MEDIA" ? "is-active" : ""} aria-pressed={workspaceMode === "MEDIA"} onClick={() => setWorkspaceMode("MEDIA")}>미디어</button>
        <button className={workspaceMode === "CODE" ? "is-active" : ""} aria-pressed={workspaceMode === "CODE"} onClick={() => setWorkspaceMode("CODE")}>코드</button>
      </nav>

      <div className="toolbar-actions">
        <button className="btn btn-quiet" onClick={handleNew}>새 보드</button>
        <button className="btn btn-quiet" onClick={() => fileInputRef.current?.click()}>가져오기</button>
        <button className="btn btn-quiet" onClick={handleCloudImport}>Cloud</button>
        <input ref={fileInputRef} className="visually-hidden" type="file" accept=".fig,application/zip" aria-label="FIG 파일 가져오기" onChange={handlePick} />
        <button className="btn btn-primary" onClick={handleSave} disabled={!doc}>저장</button>
        <button className={`btn ${previewMode ? "btn-primary" : "btn-quiet"}`} onClick={onTogglePreview} disabled={!doc}>{previewMode ? "편집" : "미리보기"}</button>
        <div className="export-wrap">
          <button className="btn btn-quiet" onClick={() => setExportOpen((open) => !open)} disabled={!doc} aria-expanded={exportOpen}>
            내보내기 <span className="caret">⌄</span>
          </button>
          {exportOpen && (
            <div className="export-menu">
              <div className="menu-label">결과 포맷</div>
              <button onClick={() => handleExport("png")}>PNG 스냅샷 <span>캔버스 화면</span></button>
              <button onClick={() => handleExport("svg")}>SVG 벡터 <span>구조 유지</span></button>
              <button onClick={() => handleExport("json")}>JSON 문서 <span>원본 데이터</span></button>
              <button onClick={() => handleExport("code")}>코드 패키지 <span>HTML · React · CSS</span></button>
              <button onClick={() => handleExport("report")}>핸드오프 리포트 <span>blocker · warning</span></button>
            </div>
          )}
        </div>
      </div>

      <div className="toolbar-divider" />

      <div className="history-actions">
        <button className="btn btn-square" title="실행 취소 (Ctrl+Z)" disabled={!canUndo} onClick={undo}>↶</button>
        <button className="btn btn-square" title="다시 실행 (Ctrl+Shift+Z)" disabled={!canRedo} onClick={redo}>↷</button>
      </div>

      <div className="view-actions">
        <button className="btn btn-square" title="축소" onClick={() => { const point = zoomCenter(); zoomBy(1 / 1.2, point.x, point.y); }}>−</button>
        <span className="zoom-label">{zoomPct}%</span>
        <button className="btn btn-square" title="확대" onClick={() => { const point = zoomCenter(); zoomBy(1.2, point.x, point.y); }}>+</button>
        <button className="btn btn-quiet btn-fit" onClick={fitToContent}>맞춤</button>
      </div>

      <div className="mobile-panel-actions">
        <button className="btn btn-square" onClick={onToggleLayers} aria-label="레이어 패널">L</button>
        <button className="btn btn-square" onClick={onToggleInspector} aria-label="속성 패널">P</button>
      </div>
    </header>
  );
}
