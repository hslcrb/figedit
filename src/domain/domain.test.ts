import { describe, expect, it } from "vitest";
import { DesignExporter } from "./DesignExporter";
import { EditorSession } from "./EditorSession";
import { CodeExporter } from "./CodeExporter";
import { pathToSvg } from "../lib/path";
import { createBlankDocument, resetIdCounter } from "../lib/figma";

describe("EditorSession", () => {
  it("문서 변형과 선택 대상을 하나의 세션으로 관리한다", () => {
    resetIdCounter();
    const { doc } = createBlankDocument();
    const session = new EditorSession();
    session.open(doc);
    const pageId = session.document?.document.children?.[0].id;

    const created = session.addChild(pageId!, "RECTANGLE", { x: 42, y: 24 });
    expect(created?.nodeId).not.toBeNull();
    expect(session.document?.document.children?.[0].children?.[0].x).toBe(42);
    expect(session.canUndo).toBe(true);

    session.undo();
    expect(session.document?.document.children?.[0].children).toHaveLength(0);
    session.redo();
    expect(session.document?.document.children?.[0].children).toHaveLength(1);
  });

  it("기존 FIG의 ID 뒤에서 새 노드를 생성하고 변형을 한 번에 되돌린다", () => {
    resetIdCounter();
    const { doc } = createBlankDocument();
    doc.document.children![0].id = "0:999";
    const session = new EditorSession();
    session.open(doc);
    const pageId = session.document?.document.children?.[0].id!;
    const created = session.addChild(pageId, "RECTANGLE");
    expect(created?.nodeId).toBe("1:0");
    session.beginTransform();
    session.moveNode(created!.nodeId!, 12, 0);
    expect(session.document?.document.children?.[0].children?.[0].x).toBe(36);
    session.undo();
    expect(session.document?.document.children?.[0].children?.[0].x).toBe(24);
  });
});

describe("DesignExporter", () => {
  it("독립 문서를 JSON과 SVG로 내보낸다", () => {
    const { doc } = createBlankDocument("board.fig");
    const exporter = new DesignExporter(doc);
    expect(exporter.toJson()).toContain('"document"');
    expect(exporter.toSvg()).toContain('<svg xmlns="http://www.w3.org/2000/svg"');
  });
});

describe("LabelStudio handoff", () => {
  it("Auto Layout을 계산하고 결정론적 코드 계약을 생성한다", () => {
    resetIdCounter();
    const { doc } = createBlankDocument();
    const session = new EditorSession();
    session.open(doc);
    const pageId = session.document?.document.children?.[0].id!;
    const frame = session.addChild(pageId, "FRAME", { x: 0, y: 0 });
    const frameId = frame?.nodeId;
    expect(frameId).toBeDefined();
    if (!frameId) return;
    session.updateNode(frameId, { width: 300, height: 100, layoutMode: "HORIZONTAL", itemSpacing: 12, paddingLeft: 8, paddingRight: 8, paddingTop: 8, paddingBottom: 8 });
    session.addChild(frameId, "RECTANGLE", { x: 0, y: 0 });
    session.addChild(frameId, "TEXT", { x: 0, y: 0 });
    session.arrangeNode(frameId);
    const children = session.document?.document.children?.[0].children?.[0].children ?? [];
    expect(children[1]?.x).toBeGreaterThan(children[0]?.x ?? 0);

    const exporter = new CodeExporter(session.document!);
    expect(exporter.html()).toContain("labelstudio-root");
    expect(exporter.css()).toContain("--ls-color-lime");
    expect(exporter.report().nodeCount).toBeGreaterThan(1);
    expect(exporter.package().byteLength).toBeGreaterThan(0);
  });
});

describe("Path and Boolean", () => {
  it("Cubic Path를 저장하고 두 도형을 단일 Boolean Path로 합친다", () => {
    resetIdCounter();
    const { doc } = createBlankDocument();
    const session = new EditorSession();
    session.open(doc);
    const pageId = session.document?.document.children?.[0].id!;
    const path = session.addPath(pageId, [{ x: 10, y: 10, handleOut: { x: 20, y: 0 } }, { x: 120, y: 80, handleIn: { x: -20, y: 0 } }], false);
    expect(path?.nodeId).toBeDefined();
    const svg = pathToSvg(session.document?.document.children?.[0].children?.[0].labelPath!);
    expect(svg).toContain("C");
    const first = session.addChild(pageId, "RECTANGLE", { x: 10, y: 120 });
    const second = session.addChild(pageId, "RECTANGLE", { x: 80, y: 160 });
    const combined = session.combineNodes([first!.nodeId!, second!.nodeId!], "UNION");
    expect(combined?.nodeId).toBeDefined();
    expect(session.document?.document.children?.[0].children?.some((node) => node.labelPath?.subpaths?.length === 2)).toBe(true);
  });
});

describe("Media document model", () => {
  it("이미지 원본 경로와 비파괴 보정값을 문서에 저장한다", () => {
    const { doc } = createBlankDocument();
    const session = new EditorSession();
    session.open(doc);
    const pageId = session.document?.document.children?.[0].id!;
    const asset = { id: "asset-demo", path: "images/demo.webp", originalName: "demo.webp", mimeType: "image/webp", width: 800, height: 400, byteLength: 100 };
    const result = session.addMedia(pageId, asset);
    const node = result && session.document ? session.document.document.children?.[0].children?.find((item) => item.id === result.nodeId) : null;
    expect(node?.fills?.[0].type).toBe("IMAGE");
    expect(node?.labelMedia?.adjustments.brightness).toBe(0);
    expect(session.document?.labelAssets?.[asset.id].path).toBe(asset.path);
  });
});
