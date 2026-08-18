import { useState } from "react";
import type { DesignTool, FigmaNode, FigmaNodeType } from "../types/figma";
import { isContainerNode } from "../types/figma";
import { countNodes } from "../lib/figma";
import { useEditorStore } from "../store/editor";

const TYPE_GLYPHS: Record<string, string> = {
  DOCUMENT: "·",
  PAGE: "◒",
  FRAME: "▣",
  GROUP: "⌘",
  SECTION: "▤",
  COMPONENT: "◆",
  COMPONENT_SET: "◇",
  INSTANCE: "◇",
  RECTANGLE: "□",
  ELLIPSE: "○",
  LINE: "—",
  POLYGON: "⬡",
  STAR: "✦",
  VECTOR: "⌁",
  TEXT: "T",
  SLICE: "┈",
  BOOLEAN_OPERATION: "⊕",
};

const TOOL_ITEMS: { tool: DesignTool; glyph: string; label: string }[] = [
  { tool: "SELECT", glyph: "↖", label: "선택" },
  { tool: "FRAME", glyph: "▣", label: "프레임" },
  { tool: "RECTANGLE", glyph: "□", label: "사각형" },
  { tool: "ELLIPSE", glyph: "○", label: "타원" },
  { tool: "TEXT", glyph: "T", label: "텍스트" },
  { tool: "PEN", glyph: "⌁", label: "Pen" },
];

const QUICK_TYPES: { type: FigmaNodeType; label: string }[] = [
  { type: "FRAME", label: "프레임" },
  { type: "RECTANGLE", label: "사각형" },
  { type: "ELLIPSE", label: "타원" },
  { type: "TEXT", label: "텍스트" },
  { type: "LINE", label: "선" },
  { type: "SECTION", label: "섹션" },
];

interface RowProps {
  node: FigmaNode;
  depth: number;
}

function TreeNode({ node, depth }: RowProps) {
  const [expanded, setExpanded] = useState(true);
  const selectedIds = useEditorStore((state) => state.selectedIds);
  const select = useEditorStore((state) => state.select);
  const deleteNode = useEditorStore((state) => state.deleteNode);
  const duplicateNode = useEditorStore((state) => state.duplicateNode);
  const reorderNode = useEditorStore((state) => state.reorderNode);
  const isContainer = isContainerNode(node);
  const selected = Boolean(node.id && selectedIds.includes(node.id));
  const count = node.children?.length ?? 0;

  return (
    <div className="tree-node">
      <div
        className={`layer-row${selected ? " is-selected" : ""}`}
        style={{ paddingLeft: 8 + depth * 14 }}
        role="treeitem"
        aria-selected={selected}
        tabIndex={0}
        onClick={(event) => select(node.id ?? null, event.shiftKey)}
        onKeyDown={(event) => {
          if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) {
            event.preventDefault();
            select(node.id ?? null);
          }
        }}
      >
        <button
          className={`layer-expander${isContainer ? " is-active" : ""}`}
          onClick={(event) => {
            event.stopPropagation();
            if (isContainer) setExpanded((open) => !open);
          }}
          aria-label={isContainer ? `${node.name ?? "레이어"} ${expanded ? "접기" : "펼치기"}` : undefined}
          type="button"
        >
          {isContainer ? (expanded ? "⌄" : "›") : ""}
        </button>
        <span className={`layer-icon kind-${node.type.toLowerCase()}`}>{TYPE_GLYPHS[node.type] ?? "·"}</span>
        <span className="layer-name" title={node.id}>{node.name || "이름 없는 레이어"}</span>
        {isContainer && <span className="layer-count">{count}</span>}
        {selected && (
          <span className="layer-actions">
            <button className="layer-action" title="위로 이동" onClick={(event) => { event.stopPropagation(); reorderNode(node.id!, -1); }}>↑</button>
            <button className="layer-action" title="아래로 이동" onClick={(event) => { event.stopPropagation(); reorderNode(node.id!, 1); }}>↓</button>
            <button className="layer-action" title="복제" onClick={(event) => { event.stopPropagation(); duplicateNode(node.id!); }}>+</button>
            <button className="layer-action is-danger" title="삭제" onClick={(event) => { event.stopPropagation(); deleteNode(node.id!); }}>×</button>
          </span>
        )}
      </div>
      {isContainer && expanded && (
        <div className="tree-children">
          {(node.children ?? []).map((child, index) => (
            <TreeNode key={`${child.id ?? child.type}-${index}`} node={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

export function LayersPanel() {
  const doc = useEditorStore((state) => state.doc);
  const activePageId = useEditorStore((state) => state.activePageId);
  const selectedId = useEditorStore((state) => state.selectedId);
  const selectedIds = useEditorStore((state) => state.selectedIds);
  const tool = useEditorStore((state) => state.tool);
  const setActivePage = useEditorStore((state) => state.setActivePage);
  const setTool = useEditorStore((state) => state.setTool);
  const addChild = useEditorStore((state) => state.addChild);
  const addPage = useEditorStore((state) => state.addPage);
  const groupSelection = useEditorStore((state) => state.groupSelection);
  const arrangeNode = useEditorStore((state) => state.arrangeNode);
  const makeComponent = useEditorStore((state) => state.makeComponent);
  const createInstance = useEditorStore((state) => state.createInstance);
  const combineSelection = useEditorStore((state) => state.combineSelection);
  const ungroupNode = useEditorStore((state) => state.ungroupNode);

  const pages = (doc?.document.children ?? []).filter((node) => node.type === "PAGE");
  const activePage = pages.find((page) => page.id === activePageId) ?? pages[0];
  const selected = selectedId && doc ? findNodeById(doc.document, selectedId) : null;
  const parentId = selected && isContainerNode(selected) ? selected.id : activePage?.id;

  const addQuickNode = (type: FigmaNodeType) => {
    if (parentId) addChild(parentId, type);
  };

  return (
    <aside className="layers-panel glass-panel">
      <div className="panel-header panel-header-tall">
        <div>
          <span className="eyebrow">STRUCTURE</span>
          <h2>Navigator</h2>
        </div>
        <div className="panel-header-actions"><span className="panel-count">{doc ? countNodes(doc.document) : 0}</span><button className="panel-add-button" onClick={addPage} aria-label="페이지 추가">+</button></div>
      </div>

      <div className="panel-body layers-body">
        <section className="panel-section tool-section">
          <div className="section-heading">
            <span className="section-title">도구</span>
            <span className="section-note">V F R O T P</span>
          </div>
          <div className="tool-grid">
            {TOOL_ITEMS.map((item) => (
              <button
                key={item.tool}
                className={`tool-button${tool === item.tool ? " is-active" : ""}`}
                aria-pressed={tool === item.tool}
                onClick={() => setTool(item.tool)}
              >
                <span className="tool-glyph">{item.glyph}</span>
                <span>{item.label}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="panel-section quick-section">
          <div className="section-heading">
            <span className="section-title">빠른 생성</span>
            <span className="section-note">{parentId ? "선택한 그룹 안에" : "페이지에"}</span>
          </div>
          <div className="quick-grid">
            {QUICK_TYPES.map((item) => (
              <button key={item.type} className="quick-button" onClick={() => addQuickNode(item.type)} disabled={!parentId}>
                <span>{TYPE_GLYPHS[item.type]}</span>{item.label}
              </button>
            ))}
          </div>
        </section>

        <section className="panel-section selection-section">
          <div className="section-heading">
            <span className="section-title">선택 작업</span>
            <span className="section-note">{selectedIds.length} selected</span>
          </div>
          <div className="selection-actions">
            <button onClick={groupSelection} disabled={selectedIds.length < 2}>그룹화</button>
            <button onClick={() => selectedIds[0] && arrangeNode(selectedIds[0])} disabled={!selected || !isContainerNode(selected)}>Auto Layout</button>
            <button onClick={() => selectedIds[0] && makeComponent(selectedIds[0])} disabled={!selected || !isContainerNode(selected)}>컴포넌트</button>
            <button onClick={() => selectedIds[0] && createInstance(selectedIds[0])} disabled={!selected || selected?.type !== "COMPONENT"}>인스턴스</button>
            <button onClick={() => combineSelection("UNION")} disabled={selectedIds.length !== 2}>Union</button>
            <button onClick={() => combineSelection("SUBTRACT")} disabled={selectedIds.length !== 2}>Subtract</button>
            <button onClick={() => selectedIds[0] && ungroupNode(selectedIds[0])} disabled={!selected || selected?.type !== "GROUP"}>그룹 해제</button>
          </div>
        </section>

        <section className="panel-section tree-section">
          <div className="section-heading">
            <span className="section-title">레이어</span>
            <span className="section-note">{pages.length} page{pages.length === 1 ? "" : "s"}</span>
          </div>
          {pages.length === 0 && <div className="panel-empty">페이지가 없습니다.</div>}
          {pages.map((page) => (
            <div key={page.id} className="page-block">
              <button className={`page-tab${activePage?.id === page.id ? " is-active" : ""}`} onClick={() => setActivePage(page.id!)}>
                <span className="layer-icon">{TYPE_GLYPHS.PAGE}</span>
                <span>{page.name || "페이지"}</span>
                <span className="page-arrow">→</span>
              </button>
              {activePage?.id === page.id && (
                <div className="page-children">
                  {(page.children ?? []).map((child, index) => (
                    <TreeNode key={`${child.id ?? child.type}-${index}`} node={child} depth={0} />
                  ))}
                  {(page.children ?? []).length === 0 && (
                    <div className="panel-empty panel-empty-left">빈 페이지. 도구를 선택해 캔버스를 클릭하세요.</div>
                  )}
                </div>
              )}
            </div>
          ))}
        </section>
      </div>

      <div className="panel-footnote">
        <span className="status-pip" /> 선택은 명시적으로, 이동은 캔버스에서
      </div>
    </aside>
  );
}

function findNodeById(root: FigmaNode, id: string): FigmaNode | null {
  if (root.id === id) return root;
  for (const child of root.children ?? []) {
    const result = findNodeById(child, id);
    if (result) return result;
  }
  return null;
}
