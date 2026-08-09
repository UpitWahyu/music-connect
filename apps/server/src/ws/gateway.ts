import type { FastifyInstance } from "fastify";
import type { PlayerStateReport } from "@music-connect/protocol";
import { prisma } from "../db/prisma.js";
import { sha256 } from "../utils.js";
import { deviceService } from "../services/device.service.js";
import { playbackService } from "../services/playback.service.js";
import {
  addController,
  registerPlayer,
  removeController,
  unregisterPlayer,
  type SocketLike,
} from "./registry.js";

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

    s.on("message", (raw) => {
      const msg = JSON.parse(String(raw)) as Record<string, unknown>;
      if (!authed) {
        if (msg.type === "auth" && typeof msg.token === "string") {
          try {
            app.jwt.verify(msg.token);
            authed = true;
            addController(s);
            s.send(JSON.stringify({ type: "auth.ok" }));
          } catch {
            s.close(4401, "UNAUTHORIZED");
          }
        } else {
          s.close(4401, "AUTH_FIRST");
        }
        return;
      }
      // TODO Phase 4: route ClientEvent → services (play/pause/seek/volume/transfer...)
    });

    s.on("close", () => removeController(s));
  });

  app.get("/ws/player", { websocket: true }, (socket) => {
    const s = socket as unknown as SocketLike;
    let deviceId: string | null = null;

    s.on("message", (raw) => {
      const msg = JSON.parse(String(raw)) as Record<string, unknown>;
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
            registerPlayer(id, s);
            await deviceService.markOnline(id);
            s.send(JSON.stringify({ type: "player.ready" }));
            // sync the stored per-device volume right after connect — mpv
            // defaults to 100% and would otherwise report/stay that way
            const vol = await deviceService.getVolume(id);
            s.send(JSON.stringify({ type: "player.setVolume", volume: vol }));
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
        unregisterPlayer(deviceId);
        void deviceService.markOffline(deviceId);
      }
    });
  });
}
