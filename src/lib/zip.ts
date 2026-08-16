import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import type { FigmaDocument } from "../types/figma";

export interface FigFileContents {
  doc: FigmaDocument;
  json: unknown;
  files: Record<string, Uint8Array>;
}

const MAIN_JSON_KEY = ".fig.json";

export function parseFigBuffer(buffer: ArrayBuffer): FigFileContents {
  const data = new Uint8Array(buffer);
  const files = unzipSync(data);

  const jsonKey = Object.keys(files).find((k) => k === MAIN_JSON_KEY || k.endsWith("/" + MAIN_JSON_KEY));
  if (!jsonKey) {
    throw new Error(".fig 아카이브에서 .fig.json 파일을 찾을 수 없습니다.");
  }

  let json: unknown;
  try {
    json = JSON.parse(strFromU8(files[jsonKey]));
  } catch (err) {
    throw new Error(`.fig.json 파싱에 실패했습니다: ${(err as Error).message}`);
  }

  const doc = json as FigmaDocument;
  if (!doc || !doc.document) {
    throw new Error(".fig.json에 document 노드가 없습니다.");
  }

  return { doc, json, files };
}

export function serializeFigDocument(doc: FigmaDocument, extraFiles: Record<string, Uint8Array> = {}): Uint8Array {
  const files: Record<string, Uint8Array> = {
    ...extraFiles,
    [MAIN_JSON_KEY]: strToU8(JSON.stringify(doc)),
  };
  return zipSync(files, { level: 6 });
}

export function downloadFig(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function readFileAsBuffer(file: File): Promise<ArrayBuffer> {
  return file.arrayBuffer();
}
