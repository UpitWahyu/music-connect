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
