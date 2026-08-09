import type { Track } from "@music-connect/types";
import { prisma } from "../db/prisma.js";

/** Favorites (PRD §29). Keyed by (userId, trackId) — re-favoriting updates metadata. */
export class FavoriteService {
  async add(userId: string, track: Track) {
    return prisma.favorite.upsert({
      where: { userId_trackId: { userId, trackId: track.id } },
      update: { title: track.title, artist: track.artist, provider: track.provider },
      create: {
        userId,
        trackId: track.id,
        provider: track.provider,
        title: track.title,
        artist: track.artist,
      },
    });
  }

  async list(userId: string) {
    return prisma.favorite.findMany({ where: { userId }, orderBy: { createdAt: "desc" } });
  }

  async remove(userId: string, trackId: string) {
    await prisma.favorite.deleteMany({ where: { userId, trackId } });
  }
}

export const favoriteService = new FavoriteService();
