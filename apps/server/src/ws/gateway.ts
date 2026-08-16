import type { FastifyInstance } from "fastify";
import {
  controllerAuthSchema,
  controllerCommandSchema,
  playerAuthSchema,
  playerEventSchema,
} from "@music-connect/protocol";
import { prisma } from "../db/prisma.js";
import { sha256 } from "../utils.js";
import { deviceService } from "../services/device.service.js";
import { playbackService } from "../services/playback.service.js";
import { authorizationService } from "../services/authorization.service.js";
import {
  addController,
  broadcastToControllers,
  isPlayerRegistered,
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
    let controllerUserId: string | null = null;
    incCounter("music_ws_connections_total");

    s.on("message", (raw) => {
      // 5.1/5.2: defensive parse + runtime validation — never trust the wire
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(String(raw)) as Record<string, unknown>;
      } catch {
        s.close(4400, "BAD_JSON");
        return;
      }
      if (!authed) {
        const parsed = controllerAuthSchema.safeParse(msg);
        if (!parsed.success) {
          s.close(4401, "AUTH_FIRST");
          return;
        }
        try {
          const payload = app.jwt.verify(parsed.data.token) as { sub?: string };
          authed = true;
          controllerUserId = payload.sub ?? null;
          addController(s, controllerUserId); // multi-user: scope broadcasts
          s.send(JSON.stringify({ type: "auth.ok" }));
        } catch {
          s.close(4401, "UNAUTHORIZED");
        }
        return;
      }
      // hybrid realtime: controllers may send lightweight commands over WS.
      // 5.1: validate shape first; unknown/malformed commands close the socket.
      const parsed = controllerCommandSchema.safeParse(msg);
      if (!parsed.success) {
        s.close(4400, "BAD_MESSAGE");
        return;
      }
      const cmd = parsed.data;
      // Every command is ownership-checked (multi-user): a controller may
      // only touch devices it owns — same rule as the REST preHandler (3.1).
      const deviceId = cmd.deviceId;
      if (!controllerUserId) return;
      void (async () => {
        try {
          await authorizationService.assertDeviceAccess(controllerUserId as string, deviceId);
        } catch {
          return; // not the caller's device — ignore silently (no info leak)
        }
        const run = (p: Promise<unknown>): void => {
          void p.catch(() => {
            /* player offline etc — the web falls back to REST on failure */
          });
        };
        if (cmd.type === "setVolume") {
          run(playbackService.setVolume(deviceId, cmd.volume)); // persists even if offline
          return;
        }
        switch (cmd.type) {
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
            run(playbackService.seek(deviceId, cmd.position));
            break;
          case "shuffle":
            run(playbackService.setShuffle(deviceId, cmd.shuffle));
            break;
          case "repeat":
            run(playbackService.setRepeat(deviceId, cmd.mode));
            break;
        }
      })();
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
        const parsed = playerAuthSchema.safeParse(msg);
        if (!parsed.success) {
          s.close(4401, "AUTH_FIRST");
          return;
        }
        const id = parsed.data.deviceId;
        void (async () => {
          // PRD §30: token validated against the stored hash (sha256)
          const device = await prisma.device.findUnique({ where: { id } });
          if (!device || device.tokenHash !== sha256(parsed.data.token)) {
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
            broadcastToControllers({ type: "device.updated", deviceId: id, device: { id, online: true } });
          })();
        return;
      }

      // 5.1: every authenticated player message must match the protocol
      const evt = playerEventSchema.safeParse(msg);
      if (!evt.success) {
        s.close(4400, "BAD_MESSAGE");
        return;
      }
      const event = evt.data;
      if (event.type === "player.heartbeat") {
        // PRD §18: heartbeat refreshes presence + last-seen
        void deviceService.markOnline(deviceId);
        return;
      }

      if (event.type === "player.state") {
        const report = event.report;
        void playbackService.applyPlayerReport(deviceId, report);
        return;
      }

      if (event.type === "player.trackEnded") {
        // PRD §25: track finished → server decides (auto-next + auto-queue).
        // reason "error" → retry the same track before advancing (Termux /
        // weak-network streams fail far more often than natural ends).
        void playbackService.onTrackEnded(deviceId, event.reason ?? "eof");
        return;
      }
    });

    s.on("close", () => {
      if (deviceId) {
        const id = deviceId;
        unregisterPlayer(id, s);
        void deviceService.markOffline(id);
        // hybrid realtime: controllers learn about the device going offline
        broadcastToControllers({ type: "device.updated", deviceId: id, device: { id, online: false } });
        // UX: if the player stays offline past the grace window (default 10s),
        // park playback as paused and keep the last position — the web
        // seekbar must stop advancing instead of running against a dead
        // player. A quick reconnect (network blip) within the window is
        // untouched. PLAYER_DC_GRACE_MS is read per-call (tests override it).
        const graceMs = Number(process.env.PLAYER_DC_GRACE_MS ?? 10000);
        const timer = setTimeout(() => {
          void (async () => {
            if (!isPlayerRegistered(id)) {
              await playbackService.pauseOnDisconnect(id);
            }
          })();
        }, graceMs);
        timer.unref?.();
      }
    });
  });
}
