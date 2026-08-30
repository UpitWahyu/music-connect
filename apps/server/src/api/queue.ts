import type { FastifyInstance } from "fastify";
import { trackSchema, queueAddSchema, reorderSchema } from "@music-connect/protocol";
import { queueService } from "../services/queue.service.js";
import { playbackService } from "../services/playback.service.js";
import { broadcastToControllers } from "../ws/registry.js";
import { safeError } from "../utils.js";

/** Queue API (PRD §24, §28). Queue is server-managed, Redis-backed (D-05). */
export async function queueRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/devices/:id/queue", async (req) => {
    const { id } = req.params as { id: string };
    // index is the GLOBAL queue cursor — same from every device of the user
    return { queue: await queueService.get(id), index: await queueService.getIndex(id) };
  });

  app.post("/api/devices/:id/queue", async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = queueAddSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: "INVALID_TRACK" });
    const queue = await queueService.add(id, parsed.data.track, parsed.data.playNext ? "next" : undefined);
    void playbackService.invalidatePrefetch(id); // queue order changed — re-pick next
    return { queue };
  });

  app.post("/api/devices/:id/queue/clear", async (req) => {
    const { id } = req.params as { id: string };
    const queue = await queueService.clear(id);
    broadcastToControllers({ type: "queue.updated", deviceId: id, queue }); // sync all browsers
    void playbackService.invalidatePrefetch(id); // nothing left to prefetch
    return { queue };
  });

  /** Deletes by stable item id — not index (see §41). */
  app.delete("/api/devices/:id/queue/:itemId", async (req) => {
    const { id, itemId } = req.params as { id: string; itemId: string };
    const queue = await queueService.remove(id, itemId);
    broadcastToControllers({ type: "queue.updated", deviceId: id, queue }); // sync all browsers
    void playbackService.invalidatePrefetch(id); // pending item may be gone
    return { queue };
  });

  /** Reorder queue by item ids (client-side sort commits the new order). */
  app.put("/api/devices/:id/queue/reorder", async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = reorderSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: "MISSING_ORDER" });
    try {
      const queue = await queueService.reorder(id, parsed.data.order);
   broadcastToControllers({ type: "queue.updated", deviceId: id, queue }); // sync all browsers
   void playbackService.invalidatePrefetch(id); // order changed — pending may be wrong
   return { queue };
 } catch (e) {
   return safeError(reply, e, 400);
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
