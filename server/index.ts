import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { URL } from "node:url";
import { WebSocketServer, WebSocket, type WebSocket as WebSocketConnection } from "ws";
import type { FigmaDocument } from "../src/types/figma";

interface Room {
  document: FigmaDocument | null;
  clients: Set<WebSocketConnection>;
}

const rooms = new Map<string, Room>();
const port = Number(process.env.PORT ?? 8787);
const allowedOrigin = process.env.ALLOWED_ORIGINS ?? "*";

function roomFor(id: string): Room {
  const existing = rooms.get(id);
  if (existing) return existing;
  const room = { document: null, clients: new Set<WebSocketConnection>() };
  rooms.set(id, room);
  return room;
}

function writeJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": allowedOrigin, "Access-Control-Allow-Headers": "Content-Type, Authorization" });
  response.end(JSON.stringify(body));
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > 25 * 1024 * 1024) throw new Error("request too large");
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function isDocument(value: unknown): value is FigmaDocument {
  return Boolean(value && typeof value === "object" && "document" in value && (value as { document?: unknown }).document && typeof (value as { document: { type?: unknown } }).document.type === "string");
}

function broadcast(room: Room, message: unknown, except?: WebSocketConnection): void {
  const encoded = JSON.stringify(message);
  for (const client of room.clients) {
    if (client !== except && client.readyState === WebSocket.OPEN) client.send(encoded);
  }
}

async function importFigmaFile(fileKey: string): Promise<FigmaDocument> {
  const token = process.env.FIGMA_ACCESS_TOKEN;
  if (!token) throw new Error("FIGMA_ACCESS_TOKEN이 서버에 설정되지 않았습니다.");
  const response = await fetch(`https://api.figma.com/v1/files/${encodeURIComponent(fileKey)}?geometry=paths`, { headers: { "X-Figma-Token": token } });
  if (!response.ok) throw new Error(`Figma API 요청 실패 (${response.status})`);
  const data = await response.json() as { name?: string; lastModified?: string; version?: string; document?: FigmaDocument["document"] };
  if (!data.document) throw new Error("Figma API 응답에 document가 없습니다.");
  return { name: data.name ?? `Figma ${fileKey}`, version: data.version, lastModified: data.lastModified, document: data.document, labelSync: { source: "FIGMA", fileKey, importedAt: new Date().toISOString() } };
}

async function handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  if (request.method === "OPTIONS") {
    response.writeHead(204, { "Access-Control-Allow-Origin": allowedOrigin, "Access-Control-Allow-Methods": "GET,POST,OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization" });
    response.end();
    return;
  }
  if (request.method === "GET" && url.pathname === "/healthz") {
    writeJson(response, 200, { ok: true, service: "LabelStudio collaboration", rooms: rooms.size, figmaCloud: Boolean(process.env.FIGMA_ACCESS_TOKEN) });
    return;
  }
  const snapshotMatch = url.pathname.match(/^\/v1\/documents\/([^/]+)\/snapshot$/);
  if (snapshotMatch && request.method === "GET") {
    writeJson(response, 200, { documentId: snapshotMatch[1], document: roomFor(snapshotMatch[1]).document });
    return;
  }
  if (snapshotMatch && request.method === "POST") {
    try {
      const body = await readJson(request) as { document?: unknown };
      if (!isDocument(body.document)) throw new Error("document가 올바르지 않습니다.");
      const room = roomFor(snapshotMatch[1]);
      room.document = body.document;
      broadcast(room, { type: "state", documentId: snapshotMatch[1], document: room.document });
      writeJson(response, 200, { ok: true });
    } catch (error) {
      writeJson(response, 400, { error: (error as Error).message });
    }
    return;
  }
  const figmaMatch = url.pathname.match(/^\/v1\/integrations\/figma\/files\/([^/]+)$/);
  if (figmaMatch && request.method === "GET") {
    try {
      writeJson(response, 200, { document: await importFigmaFile(figmaMatch[1]) });
    } catch (error) {
      writeJson(response, 502, { error: (error as Error).message });
    }
    return;
  }
  writeJson(response, 404, { error: "not found" });
}

const server = createServer((request, response) => {
  void handleRequest(request, response).catch((error) => writeJson(response, 500, { error: (error as Error).message }));
});
const websocket = new WebSocketServer({ server });

websocket.on("connection", (socket, request) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  const documentId = url.searchParams.get("documentId") ?? "default";
  const room = roomFor(documentId);
  room.clients.add(socket);
  socket.send(JSON.stringify({ type: "state", documentId, document: room.document }));
  socket.on("message", (raw) => {
    try {
      const message = JSON.parse(String(raw)) as { type?: string; document?: unknown };
      if (message.type !== "snapshot" || !isDocument(message.document)) return;
      room.document = message.document;
      broadcast(room, { type: "state", documentId, document: room.document }, socket);
    } catch {
      socket.send(JSON.stringify({ type: "error", message: "invalid message" }));
    }
  });
  socket.on("close", () => {
    room.clients.delete(socket);
    if (room.clients.size === 0 && !room.document) rooms.delete(documentId);
  });
});

server.listen(port, () => {
  console.log(`LabelStudio collaboration server listening on http://localhost:${port}`);
});
