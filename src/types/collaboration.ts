import type { FigmaDocument } from "./figma";

export type CollaborationStatus = "DISCONNECTED" | "CONNECTING" | "CONNECTED" | "ERROR";

export interface CollaborationSnapshotMessage {
  type: "snapshot";
  documentId: string;
  actorId: string;
  document: FigmaDocument;
}

export interface CollaborationHelloMessage {
  type: "hello";
  documentId: string;
  actorId: string;
}

export interface CollaborationStateMessage {
  type: "state";
  documentId: string;
  document: FigmaDocument | null;
  actorId?: string;
}

export type CollaborationMessage = CollaborationSnapshotMessage | CollaborationHelloMessage | CollaborationStateMessage;
