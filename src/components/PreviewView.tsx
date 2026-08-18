import { useCallback, useEffect, useRef, useState } from "react";
import { findNode, findParent } from "../lib/figma";
import { getNodeBounds, type FigmaNode } from "../types/figma";
import { hitTestNodeAt, renderScene, type Viewport } from "../lib/render";
import { useEditorStore } from "../store/editor";

function previewRoot(target: FigmaNode): FigmaNode {
  if (target.type === "PAGE") return target;
  return { id: "label-preview-root", type: "PAGE", name: "Preview", children: [target] };
}

function contentBounds(node: FigmaNode): { x: number; y: number; width: number; height: number } {
  if (node.type !== "PAGE" && node.type !== "DOCUMENT") return getNodeBounds(node);
  const children = node.children ?? [];
  if (children.length === 0) return { x: 0, y: 0, width: 960, height: 640 };
  const bounds = children.map(contentBounds);
  const minX = Math.min(...bounds.map((item) => item.x));
  const minY = Math.min(...bounds.map((item) => item.y));
  const maxX = Math.max(...bounds.map((item) => item.x + item.width));
  const maxY = Math.max(...bounds.map((item) => item.y + item.height));
  return { x: minX, y: minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) };
}

export function PreviewView() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [viewport, setViewport] = useState<Viewport>({ x: 40, y: 40, zoom: 1 });
  const doc = useEditorStore((state) => state.doc);
  const extraFiles = useEditorStore((state) => state.extraFiles);
  const previewTargetId = useEditorStore((state) => state.previewTargetId);
  const setPreviewMode = useEditorStore((state) => state.setPreviewMode);
  const setPreviewTarget = useEditorStore((state) => state.setPreviewTarget);
  const goPreviewBack = useEditorStore((state) => state.goPreviewBack);

  const target = doc && previewTargetId ? findNode(doc.document, previewTargetId) : null;
  const root = target ? previewRoot(target) : null;

  const fit = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !target) return;
    const bounds = contentBounds(target);
    const width = Math.max(1, canvas.clientWidth);
    const height = Math.max(1, canvas.clientHeight);
    const zoom = Math.max(0.1, Math.min(1.5, Math.min((width - 120) / Math.max(bounds.width, 1), (height - 120) / Math.max(bounds.height, 1))));
    setViewport({ x: (width - bounds.width * zoom) / 2 - bounds.x * zoom, y: (height - bounds.height * zoom) / 2 - bounds.y * zoom, zoom });
  }, [target]);

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
      fit();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    return () => observer.disconnect();
  }, [fit]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !root) return;
    const context = canvas.getContext("2d");
    if (context) renderScene(context, root, canvas.width, canvas.height, { viewport, selectedId: null, dpr: window.devicePixelRatio || 1, assets: extraFiles, onAssetLoad: () => window.dispatchEvent(new Event("labelstudio:preview-asset-loaded")) });
  }, [extraFiles, root, viewport]);

  useEffect(() => {
    const redraw = () => {
      const canvas = canvasRef.current;
      const context = canvas?.getContext("2d");
      if (canvas && context && root) renderScene(context, root, canvas.width, canvas.height, { viewport, selectedId: null, dpr: window.devicePixelRatio || 1, assets: extraFiles });
    };
    window.addEventListener("labelstudio:preview-asset-loaded", redraw);
    return () => window.removeEventListener("labelstudio:preview-asset-loaded", redraw);
  }, [extraFiles, root, viewport]);

  const onClick = (event: React.MouseEvent<HTMLCanvasElement>) => {
    if (!root || !doc) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const id = hitTestNodeAt(root, event.clientX - rect.left, event.clientY - rect.top, viewport);
    let cursor = id;
    let interaction = cursor ? doc.labelPrototype?.find((item) => item.nodeId === cursor) : undefined;
    while (!interaction && cursor) {
      cursor = findParent(doc.document, cursor)?.parent.id ?? null;
      if (cursor) interaction = doc.labelPrototype?.find((item) => item.nodeId === cursor);
    }
    if (!interaction) return;
    if (interaction.action === "BACK") goPreviewBack();
    else if (interaction.destinationId) setPreviewTarget(interaction.destinationId);
  };

  return (
    <div className="preview-view">
      <div className="preview-toolbar">
        <div><span className="eyebrow">LABELSTUDIO / PREVIEW</span><strong>{target?.name || "Prototype"}</strong></div>
        <button className="btn btn-primary" onClick={() => setPreviewMode(false)}>편집으로 돌아가기</button>
      </div>
      <canvas ref={canvasRef} data-preview-canvas role="application" tabIndex={0} aria-label="LabelStudio 프로토타입 미리보기" onClick={onClick} />
      <div className="preview-note">클릭 가능한 연결을 테스트하세요 · Esc로 편집 복귀</div>
    </div>
  );
}
