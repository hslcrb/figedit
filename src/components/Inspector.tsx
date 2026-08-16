import type { ChangeEvent } from "react";
import type { FigmaNode } from "../types/figma";
import { useEditorStore } from "../store/editor";
import { findNode } from "../lib/figma";

function rgbToHex(r: number, g: number, b: number): string {
  const to = (v: number) => Math.max(0, Math.min(255, Math.round(v * 255))).toString(16).padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const value = hex.replace("#", "");
  const full = value.length === 3 ? value.split("").map((c) => c + c).join("") : value;
  const num = parseInt(full, 16);
  return {
    r: ((num >> 16) & 255) / 255,
    g: ((num >> 8) & 255) / 255,
    b: (num & 255) / 255,
  };
}

function NumberField({
  label,
  value,
  onChange,
  step = 1,
  placeholder,
}: {
  label: string;
  value: number | undefined;
  onChange: (v: number) => void;
  step?: number;
  placeholder?: string;
}) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <input
        type="number"
        value={Number.isFinite(value) ? Math.round((value ?? 0) * 1000) / 1000 : 0}
        step={step}
        placeholder={placeholder}
        onChange={(e: ChangeEvent<HTMLInputElement>) => {
          const v = parseFloat(e.target.value);
          if (!Number.isNaN(v)) onChange(v);
        }}
      />
    </label>
  );
}

function ColorRow({
  label,
  color,
  opacity,
  onColor,
  onOpacity,
  onToggle,
  visible,
}: {
  label: string;
  color: { r: number; g: number; b: number } | undefined;
  opacity: number;
  onColor: (c: { r: number; g: number; b: number }) => void;
  onOpacity: (o: number) => void;
  onToggle?: () => void;
  visible: boolean;
}) {
  return (
    <div className="field color-field">
      <span className="field-label">{label}</span>
      <div className="color-inputs">
        <input
          type="color"
          value={color ? rgbToHex(color.r, color.g, color.b) : "#ffffff"}
          disabled={!visible}
          onChange={(e) => onColor(hexToRgb(e.target.value))}
        />
        <input
          type="number"
          min={0}
          max={100}
          value={Math.round(opacity * 100)}
          disabled={!visible}
          onChange={(e) => {
            const v = parseFloat(e.target.value);
            if (!Number.isNaN(v)) onOpacity(Math.max(0, Math.min(100, v)) / 100);
          }}
        />
        <span className="unit">%</span>
        {onToggle && (
          <button className="mini-btn" onClick={onToggle}>
            {visible ? "숨김" : "표시"}
          </button>
        )}
      </div>
    </div>
  );
}

function solidFill(node: FigmaNode): { index: number; color: { r: number; g: number; b: number } | undefined; opacity: number; visible: boolean } {
  const fills = node.fills ?? [];
  const index = fills.findIndex((f) => f.type === "SOLID");
  if (index === -1) return { index: -1, color: undefined, opacity: 1, visible: false };
  const fill = fills[index];
  return {
    index,
    color: fill.color,
    opacity: fill.opacity ?? 1,
    visible: fill.visible !== false,
  };
}

export function Inspector() {
  const doc = useEditorStore((s) => s.doc);
  const selectedId = useEditorStore((s) => s.selectedId);
  const updateNode = useEditorStore((s) => s.updateNode);
  const deleteNode = useEditorStore((s) => s.deleteNode);
  const duplicateNode = useEditorStore((s) => s.duplicateNode);

  const node = selectedId && doc ? findNode(doc.document, selectedId) : null;

  if (!node) {
    return (
      <div className="inspector-panel">
        <div className="panel-header">속성</div>
        <div className="panel-empty">선택된 노드가 없습니다.</div>
      </div>
    );
  }

  const fill = solidFill(node);
  const isText = node.type === "TEXT";
  const rectLike = ["RECTANGLE", "FRAME", "COMPONENT", "INSTANCE", "SECTION"].includes(node.type);

  const set = (patch: Partial<FigmaNode>) => updateNode(node.id!, patch);

  const setFillColor = (c: { r: number; g: number; b: number }) => {
    const fills = [...(node.fills ?? [])];
    if (fill.index === -1) {
      fills.push({ type: "SOLID", color: c, opacity: 1 });
    } else {
      fills[fill.index] = { ...fills[fill.index], color: c, visible: true };
    }
    set({ fills });
  };

  const setFillOpacity = (o: number) => {
    const fills = [...(node.fills ?? [])];
    if (fill.index === -1) return;
    fills[fill.index] = { ...fills[fill.index], opacity: o };
    set({ fills });
  };

  const toggleFillVisibility = () => {
    const fills = [...(node.fills ?? [])];
    if (fill.index === -1) return;
    fills[fill.index] = { ...fills[fill.index], visible: fill.visible ? false : true };
    set({ fills });
  };

  return (
    <div className="inspector-panel">
      <div className="panel-header">
        <span>속성</span>
        <span className="inspector-type">{node.type}</span>
      </div>
      <div className="panel-body">
        <section className="section">
          <h3 className="section-title">기본</h3>
          <label className="field">
            <span className="field-label">이름</span>
            <input value={node.name ?? ""} onChange={(e) => set({ name: e.target.value })} />
          </label>
          <div className="field">
            <span className="field-label">표시</span>
            <label className="toggle">
              <input type="checkbox" checked={node.visible !== false} onChange={(e) => set({ visible: e.target.checked })} />
              <span>{node.visible === false ? "숨김" : "표시"}</span>
            </label>
          </div>
        </section>

        {!["PAGE", "DOCUMENT"].includes(node.type) && (
          <section className="section">
            <h3 className="section-title">변형</h3>
            <div className="field-row">
              <NumberField label="X" value={node.x} onChange={(v) => set({ x: v })} />
              <NumberField label="Y" value={node.y} onChange={(v) => set({ y: v })} />
            </div>
            <div className="field-row">
              <NumberField label="W" value={node.width} onChange={(v) => set({ width: Math.max(0, v) })} />
              <NumberField label="H" value={node.height} onChange={(v) => set({ height: Math.max(0, v) })} />
            </div>
            <div className="field-row">
              <NumberField label="회전" value={node.rotation ?? 0} onChange={(v) => set({ rotation: v })} />
              <label className="field">
                <span className="field-label">불투명도</span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={Math.round((node.opacity ?? 1) * 100)}
                  onChange={(e) => {
                    const v = parseFloat(e.target.value);
                    if (!Number.isNaN(v)) set({ opacity: Math.max(0, Math.min(100, v)) / 100 });
                  }}
                />
              </label>
            </div>
            {rectLike && (
              <div className="field-row">
                <NumberField label="모서리" value={node.cornerRadius ?? 0} onChange={(v) => set({ cornerRadius: v })} />
              </div>
            )}
          </section>
        )}

        {!isText && !["PAGE", "DOCUMENT"].includes(node.type) && (
          <section className="section">
            <h3 className="section-title">채우기</h3>
            <ColorRow
              label="SOLID"
              color={fill.color}
              opacity={fill.opacity}
              visible={fill.visible}
              onColor={setFillColor}
              onOpacity={setFillOpacity}
              onToggle={toggleFillVisibility}
            />
          </section>
        )}

        {isText && (
          <section className="section">
            <h3 className="section-title">텍스트</h3>
            <label className="field">
              <span className="field-label">내용</span>
              <textarea
                rows={3}
                value={node.characters ?? ""}
                onChange={(e) => set({ characters: e.target.value })}
              />
            </label>
            <div className="field-row">
              <NumberField label="크기" value={node.style?.fontSize} onChange={(v) => set({ style: { ...node.style, fontSize: v } })} />
              <NumberField label="두께" value={node.style?.fontWeight} step={100} onChange={(v) => set({ style: { ...node.style, fontWeight: v } })} />
            </div>
            <label className="field">
              <span className="field-label">정렬</span>
              <select
                value={node.style?.textAlignHorizontal ?? "LEFT"}
                onChange={(e) => set({ style: { ...node.style, textAlignHorizontal: e.target.value as "LEFT" | "CENTER" | "RIGHT" | "JUSTIFIED" } })}
              >
                <option value="LEFT">왼쪽</option>
                <option value="CENTER">가운데</option>
                <option value="RIGHT">오른쪽</option>
                <option value="JUSTIFIED">양쪽</option>
              </select>
            </label>
          </section>
        )}

        <div className="inspector-actions">
          <button className="btn secondary" onClick={() => duplicateNode(node.id!)}>
            복제
          </button>
          <button className="btn danger" onClick={() => deleteNode(node.id!)}>
            삭제
          </button>
        </div>
      </div>
    </div>
  );
}
