import { prisma } from "../db/prisma.js";

/** Playback history (PRD §29). Records are written by PlaybackService on track load. */
export class HistoryService {
  async list(userId: string, limit = 50) {
    return prisma.playbackHistory.findMany({
      where: { userId },
      orderBy: { playedAt: "desc" },
      take: limit,
    });
  }
}

export const historyService = new HistoryService();
