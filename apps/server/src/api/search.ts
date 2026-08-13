import type { FastifyInstance } from "fastify";
import { musicService } from "../services/music.service.js";
import { redis } from "../redis/client.js";

const SEARCH_MAX_LENGTH = 100;
const SEARCH_RATE_LIMIT = 30; // requests per minute per user (11)

/** Search & metadata API (PRD §28). Results are normalized DTOs (PRD §14). */
export async function searchRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/music/search", async (req, reply) => {
    const { q } = req.query as { q?: string };
    const query = (q ?? "").trim();
    if (!query) return { tracks: [] };
    // 11: reject oversized queries instead of passing them to YouTube
    if (query.length > SEARCH_MAX_LENGTH) {
      return reply.code(400).send({ error: "QUERY_TOO_LONG" });
    }
    // 11: search is expensive — per-user rate limit (30/min)
    const user = req.user as { sub?: string } | undefined;
    if (user?.sub) {
      const key = `music:search:rl:${user.sub}`;
      const count = await redis.incr(key);
      if (count === 1) await redis.expire(key, 60);
      if (count > SEARCH_RATE_LIMIT) return reply.code(429).send({ error: "RATE_LIMITED" });
    }
    const tracks = await musicService.search(query);
    return { tracks };
  });

  app.get("/api/music/tracks/:id", async (req) => {
    const { id } = req.params as { id: string };
    const track = await musicService.getTrack(id);
    return { track };
  });

  app.get("/api/music/albums/:id", async (req) => {
    const { id } = req.params as { id: string };
    return { album: await musicService.getAlbum(id) };
  });

  app.get("/api/music/artists/:id", async (req) => {
    const { id } = req.params as { id: string };
    return { artist: await musicService.getArtist(id) };
  });

  app.get("/api/music/playlists/:id", async (req) => {
    const { id } = req.params as { id: string };
    return { playlist: await musicService.getPlaylist(id) };
  });
}
