import type { ChangeEvent } from "react";
import type { FigmaNode } from "../types/figma";
import { useEditorStore } from "../store/editor";
import { findNode, walk } from "../lib/figma";
import type { DesignToken, LabelMedia } from "../types/design";
import { DEFAULT_DESIGN_TOKENS, DEFAULT_MEDIA_ADJUSTMENTS, FULL_MEDIA_CROP } from "../types/design";

function rgbToHex(r: number, g: number, b: number): string {
  const channel = (value: number) => Math.max(0, Math.min(255, Math.round(value * 255))).toString(16).padStart(2, "0");
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const value = hex.replace("#", "");
  const full = value.length === 3 ? value.split("").map((character) => character + character).join("") : value;
  const number = parseInt(full, 16);
  return { r: ((number >> 16) & 255) / 255, g: ((number >> 8) & 255) / 255, b: (number & 255) / 255 };
}

function NumberField({
  label,
  value,
  onChange,
  step = 1,
}: {
  label: string;
  value: number | undefined;
  onChange: (value: number) => void;
  step?: number;
}) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <input
        type="number"
        value={Number.isFinite(value) ? Math.round((value ?? 0) * 1000) / 1000 : 0}
        step={step}
        onChange={(event: ChangeEvent<HTMLInputElement>) => {
          const next = parseFloat(event.target.value);
          if (!Number.isNaN(next)) onChange(next);
        }}
      />
    </label>
  );
}

function ColorRow({
  label,
  color,
  opacity,
  visible,
  onColor,
  onOpacity,
  onToggle,
  toggleLabel,
}: {
  label: string;
  color: { r: number; g: number; b: number } | undefined;
  opacity: number;
  visible: boolean;
  onColor: (color: { r: number; g: number; b: number }) => void;
  onOpacity: (opacity: number) => void;
  onToggle: () => void;
  toggleLabel: string;
}) {
  return (
    <div className="field color-field">
      <span className="field-label">{label}</span>
      <div className="color-inputs">
        <input
          type="color"
          aria-label={`${label} 색상`}
          value={color ? rgbToHex(color.r, color.g, color.b) : "#FFFFFF"}
          disabled={!visible}
          onChange={(event) => onColor(hexToRgb(event.target.value))}
        />
        <input
          className="opacity-input"
          type="number"
          aria-label={`${label} 불투명도`}
          min={0}
          max={100}
          value={Math.round(opacity * 100)}
          disabled={!visible}
          onChange={(event) => {
            const next = parseFloat(event.target.value);
            if (!Number.isNaN(next)) onOpacity(Math.max(0, Math.min(100, next)) / 100);
          }}
        />
        <span className="unit">%</span>
        <button className={`visibility-button${visible ? " is-on" : ""}`} onClick={onToggle}>{toggleLabel}</button>
      </div>
    </div>
  );
}

function solidFill(node: FigmaNode): {
  index: number;
  color: { r: number; g: number; b: number } | undefined;
  opacity: number;
  visible: boolean;
} {
  const fills = node.fills ?? [];
  const index = fills.findIndex((fill) => fill.type === "SOLID");
  if (index === -1) return { index: -1, color: undefined, opacity: 1, visible: false };
  const fill = fills[index];
  return { index, color: fill.color, opacity: fill.opacity ?? 1, visible: fill.visible !== false };
}

function tokenColor(token: DesignToken): { r: number; g: number; b: number } | null {
  if (token.type !== "COLOR" || typeof token.value !== "string") return null;
  return hexToRgb(token.value);
}

export function Inspector() {
  const doc = useEditorStore((state) => state.doc);
  const selectedId = useEditorStore((state) => state.selectedId);
  const selectedIds = useEditorStore((state) => state.selectedIds);
  const updateNode = useEditorStore((state) => state.updateNode);
  const deleteNode = useEditorStore((state) => state.deleteNode);
  const duplicateNode = useEditorStore((state) => state.duplicateNode);
  const resizeNode = useEditorStore((state) => state.resizeNode);
  const detachInstance = useEditorStore((state) => state.detachInstance);
  const alignSelection = useEditorStore((state) => state.alignSelection);
  const arrangeNode = useEditorStore((state) => state.arrangeNode);
  const updateTokens = useEditorStore((state) => state.updateTokens);
  const setPrototypeInteraction = useEditorStore((state) => state.setPrototypeInteraction);
  const clearPrototypeInteraction = useEditorStore((state) => state.clearPrototypeInteraction);

  const node = selectedId && doc ? findNode(doc.document, selectedId) : null;
  const tokens = doc?.labelTokens ?? DEFAULT_DESIGN_TOKENS;

  if (!node) {
    return (
      <aside className="inspector-panel glass-panel">
        <div className="panel-header panel-header-tall">
          <div>
            <span className="eyebrow">INSPECT</span>
            <h2>Properties</h2>
          </div>
          <span className="panel-count">—</span>
        </div>
        <div className="inspector-empty">
          <div className="empty-symbol">+</div>
          <strong>선택된 레이어 없음</strong>
          <p>캔버스나 Navigator에서 하나를 선택하면 여기서 정확한 값을 조정할 수 있습니다.</p>
          <div className="empty-rule" />
          <span className="section-note">TIP · V를 누르면 선택 도구</span>
        </div>
      </aside>
    );
  }

  const fill = solidFill(node);
  const isText = node.type === "TEXT";
  const isDocumentNode = ["PAGE", "DOCUMENT"].includes(node.type);
  const isContainer = Array.isArray(node.children);
  const rectLike = ["RECTANGLE", "FRAME", "COMPONENT", "INSTANCE", "SECTION"].includes(node.type);
  const imagePaint = node.fills?.find((paint) => paint.type === "IMAGE");
  const mediaAsset = imagePaint && doc ? Object.values(doc.labelAssets ?? {}).find((asset) => asset.path === imagePaint.imageRef || asset.id === node.labelMedia?.assetId) : undefined;
  const prototypeTargets: FigmaNode[] = [];
  if (doc) {
    walk(doc.document, (candidate) => {
      if (["PAGE", "FRAME", "COMPONENT"].includes(candidate.type) && candidate.id !== node.id) prototypeTargets.push(candidate);
    });
  }
  const interaction = doc?.labelPrototype?.find((item) => item.nodeId === node.id);

  const set = (patch: Partial<FigmaNode>) => updateNode(node.id!, patch);

  const setFillColor = (color: { r: number; g: number; b: number }) => {
    const fills = [...(node.fills ?? [])];
    if (fill.index === -1) fills.push({ type: "SOLID", color, opacity: 1, visible: true });
    else fills[fill.index] = { ...fills[fill.index], color, visible: true };
    set({ fills, labelFillTokenId: undefined });
  };

  const applyToken = (token: DesignToken) => {
    const color = tokenColor(token);
    if (!color) return;
    const fills = [...(node.fills ?? [])];
    if (fill.index === -1) fills.push({ type: "SOLID", color, opacity: 1, visible: true });
    else fills[fill.index] = { ...fills[fill.index], color, visible: true };
    set({ fills, labelFillTokenId: token.id });
  };

  const saveColorAsToken = () => {
    if (!fill.color) return;
    const id = `color-custom-${tokens.length + 1}`;
    const token: DesignToken = { id, name: `color.custom${tokens.length + 1}`, type: "COLOR", value: rgbToHex(fill.color.r, fill.color.g, fill.color.b) };
    updateTokens([...tokens, token]);
  };

  const setFillOpacity = (opacity: number) => {
    if (fill.index === -1) return;
    const fills = [...(node.fills ?? [])];
    fills[fill.index] = { ...fills[fill.index], opacity };
    set({ fills });
  };

  const toggleFillVisibility = () => {
    if (fill.index === -1) {
      setFillColor({ r: 0.85, g: 1, b: 0.29 });
      return;
    }
    const fills = [...(node.fills ?? [])];
    fills[fill.index] = { ...fills[fill.index], visible: !fill.visible };
    set({ fills });
  };

  const glassEnabled = node.studioGlass?.enabled === true;
  const toggleGlass = () => {
    set({ studioGlass: { enabled: !glassEnabled, blur: node.studioGlass?.blur ?? 18 } });
  };

  const mediaValue: LabelMedia = node.labelMedia ?? { assetId: mediaAsset?.id ?? imagePaint?.imageRef ?? "", crop: { ...FULL_MEDIA_CROP }, adjustments: { ...DEFAULT_MEDIA_ADJUSTMENTS }, alt: node.name };
  const updateMedia = (patch: Partial<LabelMedia>) => set({ labelMedia: { ...mediaValue, ...patch } });
  const updateAdjustments = (patch: Partial<LabelMedia["adjustments"]>) => updateMedia({ adjustments: { ...mediaValue.adjustments, ...patch } });

  return (
    <aside className="inspector-panel glass-panel">
      <div className="panel-header panel-header-tall inspector-heading">
        <div>
          <span className="eyebrow">INSPECT / SELECTED</span>
          <h2 title={node.name}>{node.name || "이름 없는 레이어"}</h2>
        </div>
        <span className="node-type">{node.type}</span>
      </div>
      <div className="panel-body inspector-body">
        <section className="panel-section">
          <div className="section-heading"><span className="section-title">기본</span><span className="section-note">identity</span></div>
          <label className="field field-wide">
            <span className="field-label">이름</span>
            <input value={node.name ?? ""} onChange={(event) => set({ name: event.target.value })} />
          </label>
          <div className="field visibility-field">
            <span className="field-label">표시</span>
            <label className="toggle-control">
              <input type="checkbox" checked={node.visible !== false} onChange={(event) => set({ visible: event.target.checked })} />
              <span>{node.visible === false ? "숨김" : "표시 중"}</span>
            </label>
          </div>
        </section>

        {!isDocumentNode && (
          <section className="panel-section">
            <div className="section-heading"><span className="section-title">변형</span><span className="section-note">layout</span></div>
            <div className="field-row">
              <NumberField label="X" value={node.x} onChange={(value) => set({ x: value })} />
              <NumberField label="Y" value={node.y} onChange={(value) => set({ y: value })} />
            </div>
            <div className="field-row">
              <NumberField label="W" value={node.width} onChange={(value) => resizeNode(node.id!, Math.max(0, value), node.height ?? 0)} />
              <NumberField label="H" value={node.height} onChange={(value) => resizeNode(node.id!, node.width ?? 0, Math.max(0, value))} />
            </div>
            <div className="field-row">
              <NumberField label="회전" value={node.rotation ?? 0} onChange={(value) => set({ rotation: value })} />
              <NumberField label="투명도" value={(node.opacity ?? 1) * 100} onChange={(value) => set({ opacity: Math.max(0, Math.min(100, value)) / 100 })} />
            </div>
            {rectLike && <NumberField label="모서리" value={node.cornerRadius ?? 0} onChange={(value) => set({ cornerRadius: Math.max(0, value) })} />}
          </section>
        )}

        {!isDocumentNode && (
          <section className="panel-section constraints-section">
            <div className="section-heading"><span className="section-title">반응형 제약</span><span className="section-note">constraints</span></div>
            <div className="field-row">
              <label className="field"><span className="field-label">가로</span><select value={node.constraints?.horizontal ?? "MIN"} onChange={(event) => set({ constraints: { ...node.constraints, horizontal: event.target.value as NonNullable<NonNullable<FigmaNode["constraints"]>["horizontal"]> } })}><option value="MIN">왼쪽</option><option value="CENTER">가운데</option><option value="MAX">오른쪽</option><option value="STRETCH">늘리기</option><option value="SCALE">비율</option></select></label>
              <label className="field"><span className="field-label">세로</span><select value={node.constraints?.vertical ?? "MIN"} onChange={(event) => set({ constraints: { ...node.constraints, vertical: event.target.value as NonNullable<NonNullable<FigmaNode["constraints"]>["vertical"]> } })}><option value="MIN">위</option><option value="CENTER">중앙</option><option value="MAX">아래</option><option value="STRETCH">늘리기</option><option value="SCALE">비율</option></select></label>
            </div>
            {node.layoutMode && node.layoutMode !== "NONE" && <div className="field-row"><label className="field"><span className="field-label">가로 크기</span><select value={node.layoutSizingHorizontal ?? "FIXED"} onChange={(event) => set({ layoutSizingHorizontal: event.target.value as "FIXED" | "HUG" | "FILL" })}><option value="FIXED">Fixed</option><option value="HUG">Hug</option><option value="FILL">Fill</option></select></label><label className="field"><span className="field-label">세로 크기</span><select value={node.layoutSizingVertical ?? "FIXED"} onChange={(event) => set({ layoutSizingVertical: event.target.value as "FIXED" | "HUG" | "FILL" })}><option value="FIXED">Fixed</option><option value="HUG">Hug</option><option value="FILL">Fill</option></select></label></div>}
          </section>
        )}

        {selectedIds.length > 1 && (
          <section className="panel-section">
            <div className="section-heading"><span className="section-title">정렬</span><span className="section-note">{selectedIds.length} layers</span></div>
            <div className="align-grid">
              <button onClick={() => alignSelection("horizontal", "MIN")}>좌</button>
              <button onClick={() => alignSelection("horizontal", "CENTER")}>가운데</button>
              <button onClick={() => alignSelection("horizontal", "MAX")}>우</button>
              <button onClick={() => alignSelection("vertical", "MIN")}>상</button>
              <button onClick={() => alignSelection("vertical", "CENTER")}>중간</button>
              <button onClick={() => alignSelection("vertical", "MAX")}>하</button>
              <button onClick={() => alignSelection("horizontal", "DISTRIBUTE")}>가로 분배</button>
              <button onClick={() => alignSelection("vertical", "DISTRIBUTE")}>세로 분배</button>
            </div>
          </section>
        )}

        {imagePaint && (
          <section className="panel-section media-inspector-section">
            <div className="section-heading"><span className="section-title">미디어 보정</span><span className="section-note">non-destructive</span></div>
            <div className="media-file-line"><span className="media-file-mark">IMG</span><span title={mediaAsset?.originalName ?? imagePaint.imageRef}>{mediaAsset?.originalName ?? imagePaint.imageRef ?? "원본 없음"}</span></div>
            <label className="field field-wide"><span className="field-label">맞춤</span><select value={imagePaint.scaleMode ?? "CROP"} onChange={(event) => set({ fills: (node.fills ?? []).map((paint) => paint === imagePaint ? { ...paint, scaleMode: event.target.value as "FILL" | "FIT" | "TILE" | "CROP" | "STRETCH" } : paint) })}><option value="CROP">Crop</option><option value="FIT">Fit</option><option value="STRETCH">Stretch</option><option value="FILL">Fill</option></select></label>
            <div className="media-adjustment-grid"><NumberField label="밝기" value={mediaValue.adjustments.brightness * 100} onChange={(value) => updateAdjustments({ brightness: Math.max(-1, Math.min(1, value / 100)) })} /><NumberField label="대비" value={mediaValue.adjustments.contrast * 100} onChange={(value) => updateAdjustments({ contrast: Math.max(-1, Math.min(1, value / 100)) })} /><NumberField label="채도" value={mediaValue.adjustments.saturation * 100} onChange={(value) => updateAdjustments({ saturation: Math.max(-1, Math.min(1, value / 100)) })} /><NumberField label="흑백" value={mediaValue.adjustments.grayscale * 100} onChange={(value) => updateAdjustments({ grayscale: Math.max(0, Math.min(1, value / 100)) })} /><NumberField label="블러" value={mediaValue.adjustments.blur} onChange={(value) => updateAdjustments({ blur: Math.max(0, value) })} /></div>
            <div className="section-heading media-crop-heading"><span className="section-title">Crop 영역</span><span className="section-note">0–100%</span></div>
            <div className="field-row"><NumberField label="X" value={mediaValue.crop.x * 100} onChange={(value) => updateMedia({ crop: { ...mediaValue.crop, x: Math.max(0, Math.min(1, value / 100)) } })} /><NumberField label="Y" value={mediaValue.crop.y * 100} onChange={(value) => updateMedia({ crop: { ...mediaValue.crop, y: Math.max(0, Math.min(1, value / 100)) } })} /></div>
            <div className="field-row"><NumberField label="W" value={mediaValue.crop.width * 100} onChange={(value) => updateMedia({ crop: { ...mediaValue.crop, width: Math.max(0.01, Math.min(1, value / 100)) } })} /><NumberField label="H" value={mediaValue.crop.height * 100} onChange={(value) => updateMedia({ crop: { ...mediaValue.crop, height: Math.max(0.01, Math.min(1, value / 100)) } })} /></div>
            <label className="field field-wide"><span className="field-label">alt</span><input value={mediaValue.alt ?? ""} onChange={(event) => updateMedia({ alt: event.target.value })} placeholder="이미지 설명" /></label>
            <button className="apply-layout-button" onClick={() => updateMedia({ crop: { ...FULL_MEDIA_CROP }, adjustments: { ...DEFAULT_MEDIA_ADJUSTMENTS } })}>보정 초기화</button>
          </section>
        )}

        {node.labelPath && (
          <section className="panel-section path-inspector-section">
            <div className="section-heading"><span className="section-title">벡터 Path</span><span className="section-note">{node.labelPath.points.length} anchors</span></div>
            <div className="path-status"><span className="path-status-mark">⌁</span><span>{node.labelPath.closed ? "닫힌 Bezier shape" : "열린 Bezier path"}</span><strong>{node.labelPath.points.filter((point) => point.handleIn || point.handleOut).length} curves</strong></div>
            <p className="path-help">Pen 도구에서 클릭으로 앵커를 만들고, 드래그로 곡률을 지정합니다. Enter로 열린 Path를 저장합니다.</p>
          </section>
        )}

        {!isDocumentNode && (
          <section className="panel-section">
            <div className="section-heading"><span className="section-title">표면</span><span className="section-note">appearance</span></div>
            <ColorRow
              label={isText ? "텍스트" : "채움"}
              color={fill.color}
              opacity={fill.opacity}
              visible={fill.visible}
              onColor={setFillColor}
              onOpacity={setFillOpacity}
              onToggle={toggleFillVisibility}
              toggleLabel={fill.index === -1 ? "추가" : fill.visible ? "숨김" : "표시"}
            />
            <div className="token-row">
              <span className="field-label">토큰</span>
              <div className="token-list">
                {tokens.filter((token) => token.type === "COLOR").map((token) => {
                  const color = tokenColor(token);
                  if (!color) return null;
                  return (
                    <button
                      key={token.id}
                      className={`color-token${node.labelFillTokenId === token.id ? " is-token-bound" : ""}`}
                      title={`${token.name} 토큰 적용`}
                      aria-label={`${token.name} 토큰 적용`}
                      style={{ backgroundColor: rgbToHex(color.r, color.g, color.b) }}
                      onClick={() => applyToken(token)}
                    />
                  );
                })}
              </div>
              <button className="token-add" onClick={saveColorAsToken} disabled={!fill.color} title="현재 색상을 토큰으로 저장">+</button>
            </div>
            <button className={`glass-toggle${glassEnabled ? " is-active" : ""}`} aria-pressed={glassEnabled} onClick={toggleGlass}>
              <span className="glass-toggle-mark">◌</span>
              <span><strong>유리 표면</strong><small>{glassEnabled ? "블러 표면 활성" : "반투명 표면 스타일"}</small></span>
              <span className="toggle-state">{glassEnabled ? "ON" : "OFF"}</span>
            </button>
            {glassEnabled && <NumberField label="블러" value={node.studioGlass?.blur ?? 18} onChange={(value) => set({ studioGlass: { enabled: true, blur: Math.max(0, value) } })} />}
          </section>
        )}

        {isText && (
          <section className="panel-section">
            <div className="section-heading"><span className="section-title">텍스트</span><span className="section-note">type</span></div>
            <label className="field field-wide field-textarea">
              <span className="field-label">내용</span>
              <textarea rows={3} value={node.characters ?? ""} onChange={(event) => set({ characters: event.target.value })} />
            </label>
            <div className="field-row">
              <NumberField label="크기" value={node.style?.fontSize} onChange={(value) => set({ style: { ...node.style, fontSize: value } })} />
              <NumberField label="두께" value={node.style?.fontWeight} step={100} onChange={(value) => set({ style: { ...node.style, fontWeight: value } })} />
            </div>
            <label className="field field-wide">
              <span className="field-label">정렬</span>
              <select value={node.style?.textAlignHorizontal ?? "LEFT"} onChange={(event) => set({ style: { ...node.style, textAlignHorizontal: event.target.value as "LEFT" | "CENTER" | "RIGHT" | "JUSTIFIED" } })}>
                <option value="LEFT">왼쪽</option>
                <option value="CENTER">가운데</option>
                <option value="RIGHT">오른쪽</option>
                <option value="JUSTIFIED">양쪽</option>
              </select>
            </label>
          </section>
        )}

        {isContainer && (
          <section className="panel-section">
            <div className="section-heading"><span className="section-title">컨테이너</span><span className="section-note">structure</span></div>
            <label className="field field-wide">
              <span className="field-label">배치</span>
              <select
                value={node.layoutMode ?? "NONE"}
                onChange={(event) => {
                  updateNode(node.id!, { layoutMode: event.target.value as "NONE" | "HORIZONTAL" | "VERTICAL" });
                  if (event.target.value !== "NONE") arrangeNode(node.id!);
                }}
              >
                <option value="NONE">자유 배치</option>
                <option value="HORIZONTAL">가로 Auto Layout</option>
                <option value="VERTICAL">세로 Auto Layout</option>
              </select>
            </label>
            {node.layoutMode && node.layoutMode !== "NONE" && (
              <>
                <div className="field-row">
                  <NumberField label="간격" value={node.itemSpacing ?? 0} onChange={(value) => { updateNode(node.id!, { itemSpacing: Math.max(0, value) }); arrangeNode(node.id!); }} />
                  <NumberField label="정렬" value={node.paddingLeft ?? 0} onChange={(value) => { updateNode(node.id!, { paddingLeft: Math.max(0, value), paddingRight: Math.max(0, value), paddingTop: Math.max(0, value), paddingBottom: Math.max(0, value) }); arrangeNode(node.id!); }} />
                </div>
                <button className="apply-layout-button" onClick={() => arrangeNode(node.id!)}>Auto Layout 다시 계산</button>
              </>
            )}
            <div className="field visibility-field">
              <span className="field-label">클립</span>
              <label className="toggle-control">
                <input type="checkbox" checked={node.clipContent === true} onChange={(event) => set({ clipContent: event.target.checked })} />
                <span>{node.clipContent ? "경계 안쪽" : "자유 배치"}</span>
              </label>
            </div>
          </section>
        )}

        {!isDocumentNode && (
          <section className="panel-section prototype-section">
            <div className="section-heading"><span className="section-title">프로토타입</span><span className="section-note">interaction</span></div>
            <label className="field field-wide">
              <span className="field-label">클릭</span>
              <select
                value={interaction?.action ?? "NONE"}
                onChange={(event) => {
                  if (event.target.value === "NONE") {
                    clearPrototypeInteraction(node.id!);
                    return;
                  }
                  setPrototypeInteraction({ nodeId: node.id!, action: event.target.value as "NAVIGATE" | "BACK", destinationId: prototypeTargets[0]?.id });
                }}
              >
                <option value="NONE">연결 없음</option>
                <option value="NAVIGATE">화면 이동</option>
                <option value="BACK">뒤로 가기</option>
              </select>
            </label>
            {interaction?.action === "NAVIGATE" && (
              <label className="field field-wide">
                <span className="field-label">목적지</span>
                <select value={interaction.destinationId ?? ""} onChange={(event) => setPrototypeInteraction({ ...interaction, destinationId: event.target.value })}>
                  {prototypeTargets.map((target) => <option key={target.id} value={target.id}>{target.name || target.type}</option>)}
                </select>
              </label>
            )}
          </section>
        )}

        {!isDocumentNode && (
          <section className="panel-section handoff-section">
            <div className="section-heading"><span className="section-title">핸드오프 계약</span><span className="section-note">semantic + a11y</span></div>
            <label className="field field-wide">
              <span className="field-label">HTML</span>
              <select value={node.labelSemantic ?? "auto"} onChange={(event) => set({ labelSemantic: event.target.value as FigmaNode["labelSemantic"] })}>
                <option value="auto">자동 추론</option>
                <option value="button">button</option>
                <option value="link">link</option>
                <option value="heading">heading</option>
                <option value="list">list</option>
                <option value="image">image</option>
                <option value="decorative">decorative</option>
              </select>
            </label>
            <label className="field field-wide">
              <span className="field-label">이름</span>
              <input value={node.labelAccessibleName ?? ""} placeholder="접근 가능한 이름" onChange={(event) => set({ labelAccessibleName: event.target.value })} />
            </label>
            {isContainer && (
              <>
                <label className="field field-wide">
                  <span className="field-label">컴포넌트</span>
                  <input value={node.labelComponentName ?? ""} placeholder="예: Button" onChange={(event) => set({ labelComponentName: event.target.value })} />
                </label>
                <label className="field field-wide">
                  <span className="field-label">import</span>
                  <input value={node.labelImportPath ?? ""} placeholder="@/components/Button" onChange={(event) => set({ labelImportPath: event.target.value })} />
                </label>
              </>
            )}
          </section>
        )}

        <div className="inspector-actions">
          <button className="btn btn-quiet" onClick={() => duplicateNode(node.id!)}>복제</button>
          {node.type === "INSTANCE" && <button className="btn btn-quiet" onClick={() => detachInstance(node.id!)}>연결 해제</button>}
          <button className="btn btn-danger" onClick={() => deleteNode(node.id!)}>삭제</button>
        </div>
      </div>
    </aside>
  );
}
