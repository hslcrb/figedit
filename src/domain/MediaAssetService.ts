import type { MediaAsset } from "../types/design";

function extensionFor(mimeType: string, name: string): string {
  const known: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
  return known[mimeType] ?? name.split(".").pop()?.toLowerCase() ?? "bin";
}

async function digest(bytes: Uint8Array): Promise<string> {
  if (globalThis.crypto?.subtle) {
    const hash = await globalThis.crypto.subtle.digest("SHA-256", bytes as BufferSource);
    return Array.from(new Uint8Array(hash)).map((value) => value.toString(16).padStart(2, "0")).join("").slice(0, 16);
  }
  let value = 2166136261;
  for (const byte of bytes) value = Math.imul(value ^ byte, 16777619);
  return (value >>> 0).toString(16).padStart(8, "0");
}

export class MediaAssetService {
  public async inspect(file: File): Promise<{ asset: MediaAsset; bytes: Uint8Array }> {
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) throw new Error("PNG, JPEG, WebP 이미지만 가져올 수 있습니다.");
    const bytes = new Uint8Array(await file.arrayBuffer());
    const hash = await digest(bytes);
    let width = 0;
    let height = 0;
    if (typeof createImageBitmap === "function") {
      const bitmap = await createImageBitmap(file);
      width = bitmap.width;
      height = bitmap.height;
      bitmap.close();
    } else {
      const size = await this.readImageSize(file);
      width = size.width;
      height = size.height;
    }
    const extension = extensionFor(file.type, file.name);
    const id = `asset-${hash}`;
    return {
      asset: { id, path: `images/${hash}.${extension}`, originalName: file.name, mimeType: file.type, width, height, byteLength: bytes.byteLength },
      bytes,
    };
  }

  private readImageSize(file: File): Promise<{ width: number; height: number }> {
    return new Promise((resolve, reject) => {
      const image = new Image();
      const url = URL.createObjectURL(file);
      image.onload = () => {
        resolve({ width: image.naturalWidth, height: image.naturalHeight });
        URL.revokeObjectURL(url);
      };
      image.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("이미지 크기를 읽을 수 없습니다."));
      };
      image.src = url;
    });
  }
}
