import type { FastifyInstance } from "fastify";
import type { Track } from "@music-connect/types";
import { extractPlaylistId } from "../utils.js";
import { playbackService } from "../services/playback.service.js";

function fail(reply: { code: (n: number) => unknown }, e: unknown) {
  return (reply.code(409) as unknown as { send: (o: unknown) => unknown }).send({
    error: (e as Error).message,
  });
}

/** Playback control API (PRD §28, §23). */
export async function playbackRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/devices/:id/state", async (req) => {
    const { id } = req.params as { id: string };
    return { state: await playbackService.getState(id) };
  });

  app.post("/api/devices/:id/play", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as { trackId?: string; track?: Track };
    try {
      if (body.trackId) await playbackService.play(id, body.trackId, body.track);
      else await playbackService.play(id);
      return { ok: true };
    } catch (e) {
      return fail(reply, e);
    }
  });

  app.post("/api/devices/:id/pause", async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      await playbackService.pause(id);
      return { ok: true };
    } catch (e) {
      return fail(reply, e);
    }
  });

  app.post("/api/devices/:id/resume", async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      await playbackService.resume(id);
      return { ok: true };
    } catch (e) {
      return fail(reply, e);
    }
  });

  app.post("/api/devices/:id/next", async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      await playbackService.next(id);
      return { ok: true };
    } catch (e) {
      return fail(reply, e);
    }
  });

  app.post("/api/devices/:id/previous", async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      await playbackService.previous(id);
      return { ok: true };
    } catch (e) {
      return fail(reply, e);
    }
  });

  app.post("/api/devices/:id/shuffle", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as { shuffle?: boolean };
    if (typeof body.shuffle !== "boolean") return reply.code(400).send({ error: "INVALID_SHUFFLE" });
    await playbackService.setShuffle(id, body.shuffle);
    return { ok: true };
  });

  app.post("/api/devices/:id/repeat", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as { mode?: string };
    if (body.mode !== "off" && body.mode !== "all" && body.mode !== "one") {
      return reply.code(400).send({ error: "INVALID_REPEAT_MODE" });
    }
    await playbackService.setRepeat(id, body.mode);
    return { ok: true };
  });

  app.post("/api/devices/:id/seek", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as { position?: number };
    if (typeof body.position !== "number") return reply.code(400).send({ error: "MISSING_POSITION" });
    try {
      await playbackService.seek(id, body.position);
      return { ok: true };
    } catch (e) {
      return fail(reply, e);
    }
  });

  app.post("/api/devices/:id/volume", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as { volume?: number };
    if (typeof body.volume !== "number" || body.volume < 0 || body.volume > 100) {
      return reply.code(400).send({ error: "INVALID_VOLUME" });
    }
    try {
      await playbackService.setVolume(id, body.volume);
      return { ok: true };
    } catch (e) {
      return fail(reply, e);
    }
  });

  /** Play a YT Music playlist (id or URL) — replaces the queue, starts playing. */
  app.post("/api/devices/:id/playlist", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as { playlistId?: string };
    const playlistId = body.playlistId ? extractPlaylistId(body.playlistId) : null;
    if (!playlistId) return reply.code(400).send({ error: "INVALID_PLAYLIST_ID" });
    try {
      const result = await playbackService.playPlaylist(id, playlistId);
      return result;
    } catch (e) {
      return fail(reply, e);
    }
  });

  /** Device handoff (PRD §26, D-11). */
  app.post("/api/devices/:id/transfer", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as { to?: string };
    if (!body.to) return reply.code(400).send({ error: "MISSING_TARGET" });
    try {
      await playbackService.transfer(id, body.to);
      return { ok: true };
    } catch (e) {
      return fail(reply, e);
    }
  });
}
