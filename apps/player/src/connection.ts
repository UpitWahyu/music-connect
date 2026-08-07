import { EventEmitter } from "node:events";
import WebSocket from "ws";
import type { PlayerCommand, PlayerEvent } from "@music-connect/protocol";

/**
 * Player ↔ server WebSocket client.
 * Reconnect with exponential backoff (PRD §32): 1s → 2s → 4s … max 30s.
 * After reconnect the server re-syncs and the player reports its state (D-08).
 */
export class PlayerConnection extends EventEmitter {
  private ws: WebSocket | null = null;
  private retryMs = 1000;
  private stopped = false;

  constructor(
    private readonly url: string,
    private readonly deviceId: string,
    private readonly token: string,
  ) {
    super();
  }

  connect(): void {
    const ws = new WebSocket(this.url);
    this.ws = ws;

    ws.on("open", () => {
      this.retryMs = 1000;
      ws.send(JSON.stringify({ type: "player.auth", deviceId: this.deviceId, token: this.token }));
    });

    ws.on("message", (data) => {
      const msg = JSON.parse(String(data)) as PlayerCommand | { type: string };
      if (msg.type === "player.ready") {
        this.emit("ready");
        return;
      }
      this.emit("command", msg as PlayerCommand);
    });

    ws.on("close", () => {
      this.ws = null;
      if (!this.stopped) this.scheduleReconnect();
    });

    ws.on("error", () => {
      /* close event follows — handled above */
    });
  }

  private scheduleReconnect(): void {
    setTimeout(() => this.connect(), this.retryMs).unref();
    this.retryMs = Math.min(this.retryMs * 2, 30_000);
  }

  send(ev: PlayerEvent): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(ev));
    }
  }

  stop(): void {
    this.stopped = true;
    this.ws?.close();
  }
}
