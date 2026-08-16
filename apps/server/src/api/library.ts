import type { FastifyInstance } from "fastify";
import type { Track } from "@music-connect/types";
import { RedisKeys } from "@music-connect/shared";
import { playlistService } from "../services/playlist.service.js";
import { favoriteService } from "../services/favorite.service.js";
import { historyService } from "../services/history.service.js";
import { playbackService } from "../services/playback.service.js";
import { authorizationService } from "../services/authorization.service.js";
import { redis } from "../redis/client.js";
import { broadcastToControllers } from "../ws/registry.js";

/** User id from the verified JWT (auth guard in index.ts runs first). */
function userIdOf(req: { user?: unknown }): string {
  const user = req.user as { sub?: string } | undefined;
  if (!user?.sub) throw new Error("UNAUTHORIZED");
  return user.sub;
}

/**
 * Personal library API (Phase 8, PRD §28/§29): persistent playlists,
 * favorites and playback history.
 */
export async function libraryRoutes(app: FastifyInstance): Promise<void> {
  // ---------- Playlists ----------
  app.post("/api/playlists", async (req, reply) => {
    const body = (req.body ?? {}) as { name?: string };
    if (!body.name?.trim()) return reply.code(400).send({ error: "MISSING_NAME" });
    const playlist = await playlistService.create(userIdOf(req), body.name.trim());
    return { playlist };
  });

  app.get("/api/playlists", async (req) => ({
    playlists: await playlistService.list(userIdOf(req)),
  }));

  /** Contains-status per playlist for one track (queue toggle UI). */
  app.get("/api/playlists/contains/:trackId", async (req) => {
    const { trackId } = req.params as { trackId: string };
    return { playlists: await playlistService.listWithTrackStatus(userIdOf(req), trackId) };
  });

  app.get("/api/playlists/:id", async (req) => ({
    playlist: await playlistService.get(userIdOf(req), (req.params as { id: string }).id),
  }));

  app.delete("/api/playlists/:id", async (req) => {
    await playlistService.remove(userIdOf(req), (req.params as { id: string }).id);
    return { ok: true };
  });

  app.post("/api/playlists/:id/tracks", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as { track?: Track };
    if (!body.track?.id) return reply.code(400).send({ error: "MISSING_TRACK" });
    try {
      const track = await playlistService.addTrack(userIdOf(req), id, body.track);
      return { ok: true, track };
    } catch (e) {
      return reply.code(404).send({ error: (e as Error).message });
    }
  });

  app.delete("/api/playlists/:id/tracks/:trackId", async (req, reply) => {
    const { id, trackId } = req.params as { id: string; trackId: string };
    try {
      await playlistService.removeTrack(userIdOf(req), id, trackId);
      return { ok: true };
    } catch (e) {
      return reply.code(404).send({ error: (e as Error).message });
    }
  });

  /** Play a saved playlist on a device (same Spotify semantics as YT playlists). */
  app.post("/api/playlists/:id/play", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as { deviceId?: string };
    if (!body.deviceId) return reply.code(400).send({ error: "MISSING_DEVICE_ID" });
    const playlist = await playlistService.get(userIdOf(req), id);
    if (!playlist || playlist.tracks.length === 0) return reply.code(404).send({ error: "PLAYLIST_EMPTY" });
    // P0: playlist ownership is NOT enough — the target device must belong to
    // the same user too (playlist of A → device of B must be rejected)
    try {
      await authorizationService.assertDeviceAccess(userIdOf(req), body.deviceId);
      return await playbackService.playTracks(body.deviceId, playlistService.toTracks(playlist));
    } catch (e) {
      return reply.code(403).send({ error: (e as Error).message });
    }
  });

  // ---------- Favorites ----------
  app.get("/api/favorites", async (req) => ({
    favorites: await favoriteService.list(userIdOf(req)),
  }));

  app.post("/api/favorites", async (req, reply) => {
    const body = (req.body ?? {}) as { track?: Track };
    if (!body.track?.id) return reply.code(400).send({ error: "MISSING_TRACK" });
    return { ok: true, favorite: await favoriteService.add(userIdOf(req), body.track) };
  });

  app.delete("/api/favorites/:trackId", async (req) => {
    await favoriteService.remove(userIdOf(req), (req.params as { trackId: string }).trackId);
    return { ok: true };
  });

  // ---------- History ----------
  app.get("/api/history", async (req) => ({
    history: await historyService.list(userIdOf(req)),
  }));

  app.delete("/api/history", async (req) => {
    await historyService.clear(userIdOf(req));
    return { ok: true };
  });

  // ---------- Selected device (cross-browser / cross-device sync) ----------
  app.get("/api/selected-device", async (req) => {
    const deviceId = await redis.get(RedisKeys.userSelectedDevice(userIdOf(req)));
    return { deviceId };
  });

  app.put("/api/selected-device", async (req, reply) => {
    const body = (req.body ?? {}) as { deviceId?: string };
    if (!body.deviceId) return reply.code(400).send({ error: "MISSING_DEVICE_ID" });
    await redis.set(RedisKeys.userSelectedDevice(userIdOf(req)), body.deviceId);
    broadcastToControllers({ type: "device.selected", deviceId: body.deviceId });
    return { ok: true };
  });
}
