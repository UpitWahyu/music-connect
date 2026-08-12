import type { FastifyInstance } from "fastify";
import type { PlayerStateReport } from "@music-connect/protocol";
import { prisma } from "../db/prisma.js";
import { sha256 } from "../utils.js";
import { deviceService } from "../services/device.service.js";
import { playbackService } from "../services/playback.service.js";
import {
  addController,
  broadcastToControllers,
  registerPlayer,
  removeController,
  unregisterPlayer,
  type SocketLike,
} from "./registry.js";
import { incCounter } from "../metrics.js";

/**
 * WebSocket gateway (PRD §21-§22).
 *
 * - /ws/controller — controllers subscribe to realtime events.
 * - /ws/player — player agents authenticate, receive commands, report state.
 *
 * First-message auth on both (PRD §41 D-07): the token is the first message,
 * never a query-string parameter.
 */
export async function registerWsGateway(app: FastifyInstance): Promise<void> {
  app.get("/ws/controller", { websocket: true }, (socket) => {
    const s = socket as unknown as SocketLike;
    let authed = false;
    incCounter("music_ws_connections_total");

    s.on("message", (raw) => {
      const msg = JSON.parse(String(raw)) as Record<string, unknown>;
      if (!authed) {
        if (msg.type === "auth" && typeof msg.token === "string") {
          try {
            const payload = app.jwt.verify(msg.token) as { sub?: string };
            authed = true;
            addController(s, payload.sub ?? null); // multi-user: scope broadcasts
            s.send(JSON.stringify({ type: "auth.ok" }));
          } catch {
            s.close(4401, "UNAUTHORIZED");
          }
        } else {
          s.close(4401, "AUTH_FIRST");
        }
        return;
      }
      // hybrid realtime: controllers may send lightweight commands over WS.
      // volume is the hot path (slider drags); everything else stays on REST.
      if (msg.type === "setVolume") {
        const deviceId = typeof msg.deviceId === "string" ? msg.deviceId : "";
        const volume = msg.volume;
        if (deviceId && typeof volume === "number" && Number.isFinite(volume)) {
          const clamped = Math.min(100, Math.max(0, Math.round(volume)));
          void playbackService.setVolume(deviceId, clamped).catch(() => {
            // player offline — the value still persists for the next connect
          });
        }
        return;
      }
      // lightweight transport commands (same services as the REST routes)
      const deviceId = typeof msg.deviceId === "string" ? msg.deviceId : "";
      if (!deviceId) return;
      const run = (p: Promise<unknown>): void => {
        void p.catch(() => {
          /* player offline etc — the web falls back to REST on failure */
        });
      };
      switch (msg.type) {
        case "pause":
          run(playbackService.pause(deviceId));
          break;
        case "resume":
          run(playbackService.resume(deviceId));
          break;
        case "next":
          run(playbackService.next(deviceId));
          break;
        case "previous":
          run(playbackService.previous(deviceId));
          break;
        case "seek":
          if (typeof msg.position === "number") run(playbackService.seek(deviceId, msg.position));
          break;
        case "shuffle":
          if (typeof msg.shuffle === "boolean") run(playbackService.setShuffle(deviceId, msg.shuffle));
          break;
        case "repeat":
          if (msg.mode === "off" || msg.mode === "all" || msg.mode === "one") {
            run(playbackService.setRepeat(deviceId, msg.mode));
          }
          break;
      }
    });

    s.on("close", () => removeController(s));
  });

  app.get("/ws/player", { websocket: true }, (socket) => {
    const s = socket as unknown as SocketLike;
    let deviceId: string | null = null;
    incCounter("music_ws_connections_total");

    s.on("message", (raw) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(String(raw)) as Record<string, unknown>;
      } catch {
        // malformed payload — never crash the socket
        s.close(4400, "BAD_JSON");
        return;
      }
      if (!deviceId) {
        if (
          msg.type === "player.auth" &&
          typeof msg.deviceId === "string" &&
          typeof msg.token === "string"
        ) {
          const id = msg.deviceId;
          void (async () => {
            // PRD §30: token validated against the stored hash (sha256)
            const device = await prisma.device.findUnique({ where: { id } });
            if (!device || device.tokenHash !== sha256(msg.token as string)) {
              s.close(4401, "UNAUTHORIZED");
              return;
            }
            deviceId = id;
            registerPlayer(id, s, device.userId ?? null); // owner scopes broadcasts
            await deviceService.markOnline(id);
            s.send(JSON.stringify({ type: "player.ready" }));
            // the stored per-device volume sync — mpv defaults to 100% and
            // would otherwise report/stay that way
            const vol = await deviceService.getVolume(id);
            s.send(JSON.stringify({ type: "player.setVolume", volume: vol }));
            // hybrid realtime: controllers learn about the device going online
            broadcastToControllers({ type: "device.updated", device: { id, online: true } });
          })();
        } else {
          s.close(4401, "AUTH_FIRST");
        }
        return;
      }

      if (msg.type === "player.heartbeat") {
        // PRD §18: heartbeat refreshes presence + last-seen
        void deviceService.markOnline(deviceId);
        return;
      }

      if (msg.type === "player.state" && msg.report && typeof msg.report === "object") {
        const report = msg.report as unknown as PlayerStateReport;
        void playbackService.applyPlayerReport(deviceId, report);
        return;
      }

      if (msg.type === "player.trackEnded") {
        // PRD §25: track finished → server decides (auto-next + auto-queue)
        void playbackService.onTrackEnded(deviceId);
        return;
      }
    });

    s.on("close", () => {
      if (deviceId) {
        unregisterPlayer(deviceId, s);
        void deviceService.markOffline(deviceId);
        // hybrid realtime: controllers learn about the device going offline
        broadcastToControllers({ type: "device.updated", device: { id: deviceId, online: false } });
      }
    });
  });
}
