import { useRef, useState } from "react";
import { useEditorStore } from "../store/editor";
import { MediaAssetService } from "../domain/MediaAssetService";
import type { MediaAsset } from "../types/design";

const assetService = new MediaAssetService();
const previewUrls = new Map<string, string>();

function previewUrl(asset: MediaAsset, bytes: Uint8Array | undefined): string {
  if (!bytes) return "";
  const cached = previewUrls.get(asset.path);
  if (cached) return cached;
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: asset.mimeType }));
  previewUrls.set(asset.path, url);
  return url;
}

function formatBytes(value: number): string {
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

export function MediaPanel() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [activeAssetId, setActiveAssetId] = useState<string | null>(null);
  const doc = useEditorStore((state) => state.doc);
  const extraFiles = useEditorStore((state) => state.extraFiles);
  const addMediaAsset = useEditorStore((state) => state.addMediaAsset);
  const setStatusMessage = useEditorStore((state) => state.setStatusMessage);
  const assets = Object.values(doc?.labelAssets ?? {});

  const importFile = async (file: File) => {
    try {
      const result = await assetService.inspect(file);
      addMediaAsset(result.asset, result.bytes);
      setActiveAssetId(result.asset.id);
    } catch (error) {
      setStatusMessage(`미디어를 가져올 수 없습니다: ${(error as Error).message}`);
    }
  };

  const place = (asset: MediaAsset) => {
    const bytes = extraFiles[asset.path];
    if (!bytes) {
      setStatusMessage("원본 미디어 바이트를 찾을 수 없습니다.");
      return;
    }
    addMediaAsset(asset, bytes);
  };

  return (
    <aside className="layers-panel media-panel glass-panel" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); event.stopPropagation(); const file = event.dataTransfer.files[0]; if (file) void importFile(file); }}>
      <div className="panel-header panel-header-tall">
        <div><span className="eyebrow">MEDIA / ASSETS</span><h2>Media Library</h2></div>
        <button className="panel-add-button" onClick={() => inputRef.current?.click()} aria-label="미디어 가져오기">+</button>
      </div>
      <div className="panel-body media-body">
        <input ref={inputRef} className="visually-hidden" type="file" accept="image/png,image/jpeg,image/webp" aria-label="이미지 가져오기" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importFile(file); event.target.value = ""; }} />
        <button className="media-import-card" onClick={() => inputRef.current?.click()}>
          <span className="media-import-mark">+</span>
          <strong>이미지 가져오기</strong>
          <small>PNG · JPEG · WebP / 원본 보존</small>
        </button>
        {assets.length === 0 && <div className="media-empty"><span>아직 미디어가 없습니다.</span><small>가져온 이미지는 보정값과 함께 문서에 저장됩니다.</small></div>}
        <div className="media-grid">
          {assets.map((asset) => (
            <button key={asset.id} className={`media-card${activeAssetId === asset.id ? " is-active" : ""}`} onClick={() => setActiveAssetId(asset.id)}>
              <span className="media-thumb" style={{ backgroundImage: `url(${previewUrl(asset, extraFiles[asset.path])})` }} />
              <strong title={asset.originalName}>{asset.originalName}</strong>
              <small>{asset.width} × {asset.height} · {formatBytes(asset.byteLength)}</small>
              {activeAssetId === asset.id && <span className="media-place" onClick={(event) => { event.stopPropagation(); place(asset); }}>캔버스에 배치</span>}
            </button>
          ))}
        </div>
      </div>
      <div className="panel-footnote"><span className="status-pip" /> 원본은 FIG와 핸드오프 ZIP에 함께 보존됩니다.</div>
    </aside>
  );
}
