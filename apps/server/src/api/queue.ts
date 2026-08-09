import type { FastifyInstance } from "fastify";
import type { Track } from "@music-connect/types";
import { queueService } from "../services/queue.service.js";
import { playbackService } from "../services/playback.service.js";

/** Queue API (PRD §24, §28). Queue is server-managed, Redis-backed (D-05). */
export async function queueRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/devices/:id/queue", async (req) => {
    const { id } = req.params as { id: string };
    return { queue: await queueService.get(id) };
  });

  app.post("/api/devices/:id/queue", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as { track?: Track; playNext?: boolean };
    if (!body.track) return reply.code(400).send({ error: "MISSING_TRACK" });
    const queue = await queueService.add(id, body.track, body.playNext ? "next" : undefined);
    return { queue };
  });

  app.post("/api/devices/:id/queue/clear", async (req) => {
    const { id } = req.params as { id: string };
    return { queue: await queueService.clear(id) };
  });

  /** Deletes by stable item id — not index (see §41). */
  app.delete("/api/devices/:id/queue/:itemId", async (req) => {
    const { id, itemId } = req.params as { id: string; itemId: string };
    return { queue: await queueService.remove(id, itemId) };
  });

  /** Play an existing queue item now. TODO Phase 6: resolve media ref. */
  app.post("/api/devices/:id/queue/:itemId/play", async (req, reply) => {
    const { id, itemId } = req.params as { id: string; itemId: string };
    const queue = await queueService.get(id);
    const item = queue.find((i) => i.id === itemId);
    if (!item) return reply.code(404).send({ error: "ITEM_NOT_FOUND" });
    try {
      await playbackService.play(id, item.track.id, item.track);
      return { ok: true };
    } catch (e) {
      return reply.code(409).send({ error: (e as Error).message });
    }
  });
}
