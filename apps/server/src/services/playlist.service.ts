import type { Track } from "@music-connect/types";
import { prisma } from "../db/prisma.js";

/**
 * Persistent playlists (PRD §29, D-05: playlists in MySQL, queue stays in Redis).
 * Tracks are stored as stable provider ids + snapshot metadata (PRD §15 —
 * never temporary stream URLs).
 */
export class PlaylistService {
  async create(userId: string, name: string) {
    return prisma.playlist.create({ data: { userId, name } });
  }

  async list(userId: string) {
    return prisma.playlist.findMany({
      where: { userId },
      orderBy: { updatedAt: "desc" },
      include: { _count: { select: { tracks: true } } },
    });
  }

  async get(userId: string, id: string) {
    return prisma.playlist.findFirst({
      where: { id, userId },
      include: { tracks: { orderBy: { position: "asc" } } },
    });
  }

  async remove(userId: string, id: string) {
    const playlist = await prisma.playlist.findFirst({ where: { id, userId }, select: { id: true } });
    if (!playlist) return 0;
    // MySQL doesn't cascade — delete child tracks first (P2003)
    await prisma.$transaction([
      prisma.playlistTrack.deleteMany({ where: { playlistId: id } }),
      prisma.playlist.delete({ where: { id } }),
    ]);
    return 1;
  }

  async addTrack(userId: string, playlistId: string, track: Track) {
    const playlist = await prisma.playlist.findFirst({ where: { id: playlistId, userId }, select: { id: true } });
    if (!playlist) throw new Error("PLAYLIST_NOT_FOUND");
    const max = await prisma.playlistTrack.aggregate({ where: { playlistId }, _max: { position: true } });
    const position = (max._max.position ?? -1) + 1;
    return prisma.playlistTrack.upsert({
      where: { playlistId_trackId: { playlistId, trackId: track.id } },
      update: {
        title: track.title,
        artist: track.artist,
        album: track.album ?? null,
        duration: track.duration,
        thumbnail: track.thumbnail ?? null,
      },
      create: {
        playlistId,
        trackId: track.id,
        provider: track.provider,
        title: track.title,
        artist: track.artist,
        album: track.album ?? null,
        duration: track.duration,
        thumbnail: track.thumbnail ?? null,
        position,
      },
    });
  }

  /** Playlists with whether they already contain the given track (toggle UI). */
  async listWithTrackStatus(userId: string, trackId: string) {
    const playlists = await prisma.playlist.findMany({
      where: { userId },
      include: { tracks: { where: { trackId }, select: { id: true } } },
    });
    return playlists.map((p) => ({ id: p.id, name: p.name, contains: p.tracks.length > 0 }));
  }

  async removeTrack(userId: string, playlistId: string, trackId: string) {
    const playlist = await prisma.playlist.findFirst({ where: { id: playlistId, userId }, select: { id: true } });
    if (!playlist) throw new Error("PLAYLIST_NOT_FOUND");
    await prisma.playlistTrack.deleteMany({ where: { playlistId, trackId } });
    // renumber positions so the ordering stays dense
    const tracks = await prisma.playlistTrack.findMany({ where: { playlistId }, orderBy: { position: "asc" } });
    await prisma.$transaction(
      tracks.map((t, i) => prisma.playlistTrack.update({ where: { id: t.id }, data: { position: i } })),
    );
  }

  /** Playlist rows → domain Track[] (snapshot metadata from the playlist). */
  toTracks(playlist: { tracks: Array<{ trackId: string; provider: string; title: string; artist: string; album: string | null; duration: number; thumbnail: string | null }> }): Track[] {
    return playlist.tracks.map((t) => ({
      id: t.trackId,
      provider: t.provider,
      title: t.title,
      artist: t.artist,
      album: t.album ?? undefined,
      duration: t.duration,
      thumbnail: t.thumbnail ?? undefined,
    }));
  }
}

export const playlistService = new PlaylistService();
