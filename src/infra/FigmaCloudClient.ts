import type { FigmaDocument } from "../types/figma";

export class FigmaCloudClient {
  private readonly apiBaseUrl: string;

  public constructor(apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8787") {
    this.apiBaseUrl = apiBaseUrl.replace(/\/$/, "");
  }

  public async importFile(fileKey: string): Promise<FigmaDocument> {
    const response = await fetch(`${this.apiBaseUrl}/v1/integrations/figma/files/${encodeURIComponent(fileKey)}`);
    if (!response.ok) throw new Error(`Figma Cloud 요청 실패 (${response.status})`);
    const payload = await response.json() as { document: FigmaDocument };
    if (!payload.document?.document) throw new Error("Figma Cloud 응답에 document가 없습니다.");
    return payload.document;
  }
}
