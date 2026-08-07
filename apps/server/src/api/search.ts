import type { FastifyInstance } from "fastify";
import { musicService } from "../services/music.service.js";

/** Search & metadata API (PRD §28). Results are normalized DTOs (PRD §14). */
export async function searchRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/music/search", async (req) => {
    const { q } = req.query as { q?: string };
    if (!q || q.trim() === "") return { tracks: [] };
    const tracks = await musicService.search(q.trim());
    return { tracks };
  });

  app.get("/api/music/tracks/:id", async (req) => {
    const { id } = req.params as { id: string };
    const track = await musicService.getTrack(id);
    return { track };
  });
}
