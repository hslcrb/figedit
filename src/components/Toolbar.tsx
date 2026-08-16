import { useRef } from "react";
import { useEditorStore } from "../store/editor";
import { createNewDocument } from "../lib/figma";
import { downloadFig, parseFigBuffer, serializeFigDocument } from "../lib/zip";

export function Toolbar() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const doc = useEditorStore((s) => s.doc);
  const fileName = useEditorStore((s) => s.fileName);
  const extraFiles = useEditorStore((s) => s.extraFiles);
  const viewport = useEditorStore((s) => s.viewport);
  const canUndo = useEditorStore((s) => s.canUndo);
  const canRedo = useEditorStore((s) => s.canRedo);
  const loadDoc = useEditorStore((s) => s.loadDoc);
  const zoomBy = useEditorStore((s) => s.zoomBy);
  const fitToContent = useEditorStore((s) => s.fitToContent);
  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);

  const openFile = async (file: File) => {
    try {
      const buffer = await file.arrayBuffer();
      const { doc, files } = parseFigBuffer(buffer);
      loadDoc(doc, file.name, files);
    } catch (err) {
      alert(`파일을 열 수 없습니다.\n${(err as Error).message}`);
    }
  };

  const handlePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) void openFile(file);
    e.target.value = "";
  };

  const handleSave = () => {
    if (!doc) return;
    const data = serializeFigDocument(doc, extraFiles);
    const blob = new Blob([data as BlobPart], { type: "application/zip" });
    downloadFig(blob, fileName || "Untitled.fig");
  };

  const handleNew = () => {
    const { doc: newDoc, fileName: newName } = createNewDocument();
    loadDoc(newDoc, newName);
  };

  const zoomPct = Math.round(viewport.zoom * 100);

  return (
    <div className="toolbar">
      <div className="brand">
        <span className="brand-logo">F</span>
        <span>FigEdit</span>
      </div>
      <div className="toolbar-group">
        <button className="btn" onClick={handleNew}>
          새 파일
        </button>
        <button className="btn" onClick={() => fileInputRef.current?.click()}>
          열기
        </button>
        <input ref={fileInputRef} type="file" accept=".fig,application/zip" hidden onChange={handlePick} />
        <button className="btn primary" onClick={handleSave} disabled={!doc}>
          저장
        </button>
      </div>
      <div className="toolbar-group">
        <button className="btn icon" title="실행 취소 (Ctrl+Z)" disabled={!canUndo} onClick={undo}>
          ↩
        </button>
        <button className="btn icon" title="다시 실행 (Ctrl+Shift+Z)" disabled={!canRedo} onClick={redo}>
          ↪
        </button>
      </div>
      <div className="toolbar-group zoom-group">
        <button className="btn icon" title="축소" onClick={() => zoomBy(1 / 1.2, window.innerWidth / 2, 48)}>
          −
        </button>
        <span className="zoom-label">{zoomPct}%</span>
        <button className="btn icon" title="확대" onClick={() => zoomBy(1.2, window.innerWidth / 2, 48)}>
          +
        </button>
        <button className="btn" title="내용에 맞추기" onClick={fitToContent}>
          맞춤
        </button>
      </div>
      <div className="toolbar-file">
        <span className="file-name" title={fileName}>
          {fileName}
        </span>
        <span className={`dot${doc ? " loaded" : ""}`} />
      </div>
    </div>
  );
}
