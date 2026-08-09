import type { FastifyInstance } from "fastify";
import type { Track } from "@music-connect/types";
import { queueService } from "../services/queue.service.js";
import { playbackService } from "../services/playback.service.js";
import { broadcastToControllers } from "../ws/registry.js";

/** Queue API (PRD §24, §28). Queue is server-managed, Redis-backed (D-05). */
export async function queueRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/devices/:id/queue", async (req) => {
    const { id } = req.params as { id: string };
    // index is the GLOBAL queue cursor — same from every device of the user
    return { queue: await queueService.get(id), index: await queueService.getIndex(id) };
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
    const queue = await queueService.remove(id, itemId);
    broadcastToControllers({ type: "queue.updated", deviceId: id, queue }); // sync all browsers
    return { queue };
  });

  /** Reorder queue by item ids (client-side sort commits the new order). */
  app.put("/api/devices/:id/queue/reorder", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as { order?: string[] };
    if (!Array.isArray(body.order) || body.order.length === 0) {
      return reply.code(400).send({ error: "MISSING_ORDER" });
    }
    try {
      const queue = await queueService.reorder(id, body.order);
      broadcastToControllers({ type: "queue.updated", deviceId: id, queue }); // sync all browsers
      return { queue };
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
  });

  /** Play an existing queue item now. */
  app.post("/api/devices/:id/queue/:itemId/play", async (req, reply) => {
    const { id, itemId } = req.params as { id: string; itemId: string };
    const queue = await queueService.get(id);
    const item = queue.find((i) => i.id === itemId);
    if (!item) return reply.code(404).send({ error: "ITEM_NOT_FOUND" });
    // move the global cursor to the played item (also keeps the UI highlight right)
    await queueService.setIndex(id, queue.findIndex((i) => i.id === itemId));
    try {
      await playbackService.play(id, item.track.id, item.track);
      return { ok: true };
    } catch (e) {
      return reply.code(409).send({ error: (e as Error).message });
    }
  });
}
