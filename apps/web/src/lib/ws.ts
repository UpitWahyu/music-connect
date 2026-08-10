import type { ServerEvent } from "@music-connect/protocol";
import { getToken } from "./api";

export type WsListener = (event: ServerEvent) => void;

/**
 * Controller WebSocket (PRD §21, D-07 first-message auth).
 * Auto-reconnects every 3s. Returns { disconnect, send }.
 * send() returns false when the socket is not open — callers fall back to REST.
 */
export function connectControllerWs(onEvent: WsListener): { disconnect: () => void; send: (obj: unknown) => boolean } {
  let closed = false;
  let ws: WebSocket | null = null;

  const connect = (): void => {
    if (closed) return;
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    ws = new WebSocket(`${proto}//${location.host}/ws/controller`);

    ws.onopen = () => {
      const t = getToken();
      if (t) ws?.send(JSON.stringify({ type: "auth", token: t }));
    };

    ws.onmessage = (e) => {
      const msg = JSON.parse(String(e.data)) as { type: string };
      if (msg.type === "auth.ok") return;
      onEvent(msg as ServerEvent);
    };

    ws.onclose = () => {
      if (!closed) setTimeout(connect, 3000);
    };

    ws.onerror = () => {
      ws?.close();
    };
  };

  connect();
  return {
    disconnect: () => {
      closed = true;
      ws?.close();
    },
    send: (obj: unknown): boolean => {
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(obj));
        return true;
      }
      return false;
    },
  };
}
