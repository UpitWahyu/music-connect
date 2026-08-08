import type { Track } from "@music-connect/types";
import { RedisKeys } from "@music-connect/shared";
import { redis } from "../redis/client.js";
import { musicService } from "./music.service.js";
import { queueService } from "./queue.service.js";

/**
 * Auto-queue (Spotify-like): when the queue runs low, fetch recommended
 * tracks seeded from the currently playing track (YT Music "Up Next") and
 * append them as addedBy: "auto".
 *
 * Config (env):
 *   AUTO_QUEUE_THRESHOLD — refill when items remaining <= threshold (default 2)
 *   AUTO_QUEUE_BATCH     — how many recommendations to append per refill (default 10)
 */
const AUTO_QUEUE_THRESHOLD = Number(process.env.AUTO_QUEUE_THRESHOLD ?? 2);
const AUTO_QUEUE_BATCH = Number(process.env.AUTO_QUEUE_BATCH ?? 10);
const UP_NEXT_CACHE_TTL_SECONDS = 600; // D-09: cache recommendations 10 min

export class AutoQueueService {
  /** Refill the queue if it's running low. Returns how many tracks were added. */
  async ensure(deviceId: string, seedTrackId: string | null): Promise<number> {
    if (!seedTrackId) return 0;
    const queue = await queueService.get(deviceId);
    const index = await queueService.getIndex(deviceId);
    if (queue.length - index - 1 >= AUTO_QUEUE_THRESHOLD) return 0;

    const recommendations = await this.fetchRecommendations(seedTrackId);
    const existing = new Set(queue.map((i) => i.track.id));
    let added = 0;
    for (const track of recommendations) {
      if (existing.has(track.id)) continue;
      await queueService.addAuto(deviceId, track);
      existing.add(track.id);
      added++;
      if (added >= AUTO_QUEUE_BATCH) break;
    }
    return added;
  }

  private async fetchRecommendations(seedTrackId: string): Promise<Track[]> {
    const cacheKey = RedisKeys.cacheRecommendations(seedTrackId);
    const cached = await redis.get(cacheKey);
    if (cached) return JSON.parse(cached) as Track[];
    const tracks = await musicService.getUpNext(seedTrackId, AUTO_QUEUE_BATCH);
    if (tracks.length > 0) {
      await redis.set(cacheKey, JSON.stringify(tracks), "EX", UP_NEXT_CACHE_TTL_SECONDS);
    }
    return tracks;
  }
}

export const autoQueueService = new AutoQueueService();
