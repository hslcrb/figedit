import type { FigmaDocument } from "../types/figma";
import type { CollaborationMessage, CollaborationStatus } from "../types/collaboration";

export class CollaborationClient {
  private socket: WebSocket | null = null;
  private documentId = "";
  private actorId = "";
  private onSnapshot: ((document: FigmaDocument) => void) | null = null;
  private onStatus: ((status: CollaborationStatus) => void) | null = null;

  public connect(
    url: string,
    documentId: string,
    actorId: string,
    onSnapshot: (document: FigmaDocument) => void,
    onStatus: (status: CollaborationStatus) => void,
  ): void {
    this.disconnect();
    this.documentId = documentId;
    this.actorId = actorId;
    this.onSnapshot = onSnapshot;
    this.onStatus = onStatus;
    onStatus("CONNECTING");
    const joinUrl = new URL(url);
    joinUrl.searchParams.set("documentId", documentId);
    joinUrl.searchParams.set("actorId", actorId);
    const socket = new WebSocket(joinUrl);
    this.socket = socket;
    socket.onopen = () => {
      this.onStatus?.("CONNECTED");
      socket.send(JSON.stringify({ type: "hello", documentId, actorId }));
    };
    socket.onmessage = (event) => {
      try {
        const message = JSON.parse(String(event.data)) as CollaborationMessage;
        if (message.type === "state" && message.document) this.onSnapshot?.(message.document);
      } catch {
        this.onStatus?.("ERROR");
      }
    };
    socket.onerror = () => this.onStatus?.("ERROR");
    socket.onclose = () => {
      if (this.socket === socket) {
        this.socket = null;
        this.onStatus?.("DISCONNECTED");
      }
    };
  }

  public send(document: FigmaDocument): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify({ type: "snapshot", documentId: this.documentId, actorId: this.actorId, document }));
  }

  public disconnect(): void {
    this.socket?.close();
    this.socket = null;
    this.onStatus?.("DISCONNECTED");
  }
}
