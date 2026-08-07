import type { Track } from "@music-connect/types";
import { RedisKeys } from "@music-connect/shared";
import { redis } from "../redis/client.js";
import type { MusicProvider } from "../providers/music-provider.js";
import { YoutubeMusicProvider } from "../providers/youtube-music.js";

const SEARCH_TTL_SECONDS = 300; // D-09
const METADATA_TTL_SECONDS = 86_400; // D-09

/**
 * Provider-facing facade with Redis caching (D-09) so youtubei.js is not
 * hammered and queue renders stay fast.
 */
export class MusicService {
  private readonly providers: MusicProvider[] = [new YoutubeMusicProvider()];

  private provider(id: string): MusicProvider | undefined {
    return this.providers.find((p) => p.id === id);
  }

  async search(query: string): Promise<Track[]> {
    const cacheKey = RedisKeys.cacheSearch(query);
    const cached = await redis.get(cacheKey);
    if (cached) return JSON.parse(cached) as Track[];
    const results = (await this.provider("youtube-music")?.search(query)) ?? [];
    if (results.length > 0) await redis.set(cacheKey, JSON.stringify(results), "EX", SEARCH_TTL_SECONDS);
    return results;
  }

  async getTrack(id: string): Promise<Track | null> {
    const cacheKey = RedisKeys.cacheMetadata("youtube-music", id);
    const cached = await redis.get(cacheKey);
    if (cached) return JSON.parse(cached) as Track;
    const track = (await this.provider("youtube-music")?.getTrack(id)) ?? null;
    if (track) await redis.set(cacheKey, JSON.stringify(track), "EX", METADATA_TTL_SECONDS);
    return track;
  }
}

export const musicService = new MusicService();
