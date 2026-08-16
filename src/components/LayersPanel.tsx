import { useState } from "react";
import type { FigmaNode, FigmaNodeType } from "../types/figma";
import { isContainerNode } from "../types/figma";
import { useEditorStore } from "../store/editor";

const TYPE_ICONS: Record<string, string> = {
  DOCUMENT: "▤",
  PAGE: "📄",
  FRAME: "◻",
  GROUP: "▣",
  SECTION: "▧",
  COMPONENT: "◇",
  COMPONENT_SET: "◆",
  INSTANCE: "◇",
  RECTANGLE: "▭",
  ELLIPSE: "◯",
  LINE: "╱",
  POLYGON: "⬠",
  STAR: "★",
  VECTOR: "✦",
  TEXT: "T",
  SLICE: "✂",
  STICKY: "◉",
  CONNECTOR: "↗",
  BOOLEAN_OPERATION: "⊕",
};

const QUICK_TYPES: FigmaNodeType[] = [
  "FRAME",
  "GROUP",
  "RECTANGLE",
  "ELLIPSE",
  "LINE",
  "TEXT",
  "POLYGON",
  "STAR",
  "VECTOR",
  "SLICE",
  "SECTION",
  "COMPONENT",
];

function typeLabel(node: FigmaNode): string {
  return node.type.replace(/_/g, " ");
}

interface RowProps {
  node: FigmaNode;
  depth: number;
}

function TreeNode({ node, depth }: RowProps) {
  const [expanded, setExpanded] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const selectedId = useEditorStore((s) => s.selectedId);
  const select = useEditorStore((s) => s.select);
  const deleteNode = useEditorStore((s) => s.deleteNode);
  const duplicateNode = useEditorStore((s) => s.duplicateNode);
  const addChild = useEditorStore((s) => s.addChild);
  const reorderNode = useEditorStore((s) => s.reorderNode);

  const isContainer = isContainerNode(node);
  const selected = selectedId === node.id;
  const count = node.children?.length ?? 0;

  const handleAdd = (type: FigmaNodeType) => {
    addChild(node.id!, type);
    setShowAdd(false);
  };

  return (
    <div>
      <div
        className={`layer-row${selected ? " selected" : ""}`}
        style={{ paddingLeft: 6 + depth * 14 }}
        onClick={() => select(node.id!)}
      >
        <span
          className="layer-expander"
          onClick={(e) => {
            e.stopPropagation();
            if (isContainer) setExpanded(!expanded);
          }}
        >
          {isContainer ? (expanded ? "▾" : "▸") : ""}
        </span>
        <span className="layer-icon">{TYPE_ICONS[node.type] ?? "•"}</span>
        <span className="layer-name" title={node.id}>
          {node.name || "(이름 없음)"}
        </span>
        {isContainer && <span className="layer-count">{count}</span>}
        <span className="layer-actions">
          {isContainer && (
            <span
              className="layer-btn"
              title="자식 노드 추가"
              onClick={(e) => {
                e.stopPropagation();
                setShowAdd(!showAdd);
              }}
            >
              ＋
            </span>
          )}
          <span
            className="layer-btn"
            title="위로 이동"
            onClick={(e) => {
              e.stopPropagation();
              reorderNode(node.id!, -1);
            }}
          >
            ↑
          </span>
          <span
            className="layer-btn"
            title="아래로 이동"
            onClick={(e) => {
              e.stopPropagation();
              reorderNode(node.id!, 1);
            }}
          >
            ↓
          </span>
          <span
            className="layer-btn"
            title="복제"
            onClick={(e) => {
              e.stopPropagation();
              duplicateNode(node.id!);
            }}
          >
            ⧉
          </span>
          <span
            className="layer-btn danger"
            title="삭제"
            onClick={(e) => {
              e.stopPropagation();
              deleteNode(node.id!);
            }}
          >
            ✕
          </span>
        </span>
      </div>
      {showAdd && (
        <div className="add-menu" style={{ marginLeft: 6 + depth * 14 + 22 }}>
          {QUICK_TYPES.map((t) => (
            <button key={t} className="add-menu-item" onClick={() => handleAdd(t)}>
              {TYPE_ICONS[t] ?? "•"} {typeLabel({ type: t } as FigmaNode)}
            </button>
          ))}
        </div>
      )}
      {isContainer && expanded && (
        <div>
          {(node.children ?? []).map((child) => (
            <TreeNode key={child.id ?? crypto.randomUUID()} node={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

export function LayersPanel() {
  const doc = useEditorStore((s) => s.doc);
  const activePageId = useEditorStore((s) => s.activePageId);
  const setActivePage = useEditorStore((s) => s.setActivePage);
  const addChild = useEditorStore((s) => s.addChild);

  const pages = (doc?.document.children ?? []).filter((n) => n.type === "PAGE");
  const activePage = pages.find((p) => p.id === activePageId) ?? pages[0];

  return (
    <div className="layers-panel">
      <div className="panel-header">
        <span>레이어</span>
        {activePage && (
          <button className="mini-btn" onClick={() => addChild(activePage.id!, "FRAME")}>
            + 프레임
          </button>
        )}
      </div>
      <div className="panel-body">
        {pages.length === 0 && <div className="panel-empty">페이지가 없습니다.</div>}
        {pages.map((page) => (
          <div key={page.id} className="page-block">
            <div
              className={`page-tab${activePage?.id === page.id ? " active" : ""}`}
              onClick={() => setActivePage(page.id!)}
            >
              <span className="layer-icon">{TYPE_ICONS.PAGE}</span>
              {page.name || "페이지"}
            </div>
            {activePage?.id === page.id && (
              <div>
                {(page.children ?? []).map((child) => (
                  <TreeNode key={child.id ?? crypto.randomUUID()} node={child} depth={0} />
                ))}
                {((page.children ?? []).length === 0 && (
                  <div className="panel-empty">빈 페이지. 오른쪽의 + 프레임 버튼으로 시작하세요.</div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
