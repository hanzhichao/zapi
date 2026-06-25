import type { WsMessage } from "./types";

// Module-level map: requestId → WebSocket
const connections = new Map<string, WebSocket>();

type OnMessage = (msg: WsMessage) => void;
type OnStateChange = (connected: boolean) => void;

function makeMsg(direction: WsMessage["direction"], data: string): WsMessage {
  return { id: crypto.randomUUID(), direction, data, timestamp: Date.now() };
}

export function connectWs(
  requestId: string,
  url: string,
  onMessage: OnMessage,
  onStateChange: OnStateChange
): void {
  // Close any existing connection for this request
  disconnectWs(requestId);

  let ws: WebSocket;
  try {
    ws = new WebSocket(url);
  } catch (e) {
    onMessage(makeMsg("error", `Failed to create WebSocket: ${String(e)}`));
    return;
  }

  connections.set(requestId, ws);
  onMessage(makeMsg("info", `Connecting to ${url}…`));

  ws.onopen = () => {
    onStateChange(true);
    onMessage(makeMsg("info", "Connection established"));
  };

  ws.onmessage = (event) => {
    const data = typeof event.data === "string" ? event.data : "[binary data]";
    onMessage(makeMsg("received", data));
  };

  ws.onerror = () => {
    onMessage(makeMsg("error", "WebSocket error"));
  };

  ws.onclose = (event) => {
    connections.delete(requestId);
    onStateChange(false);
    onMessage(makeMsg("info", `Disconnected (code ${event.code}${event.reason ? ": " + event.reason : ""})`));
  };
}

export function disconnectWs(requestId: string): void {
  const ws = connections.get(requestId);
  if (ws) {
    ws.close();
    connections.delete(requestId);
  }
}

export function sendWsMessage(requestId: string, data: string): boolean {
  const ws = connections.get(requestId);
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(data);
    return true;
  }
  return false;
}

export function isWsConnected(requestId: string): boolean {
  const ws = connections.get(requestId);
  return !!ws && ws.readyState === WebSocket.OPEN;
}
