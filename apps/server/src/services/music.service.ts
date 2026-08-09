import type { Track, Album, Artist, Playlist } from "@music-connect/types";
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

  /** Single-flight: concurrent identical lookups share one provider call. */
  private readonly inFlight = new Map<string, Promise<unknown>>();

  private withSingleFlight<T>(key: string, fetch: () => Promise<T>): Promise<T> {
    const existing = this.inFlight.get(key);
    if (existing) return existing as Promise<T>;
    const p = fetch().finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, p);
    return p;
  }

  private provider(id: string): MusicProvider | undefined {
    return this.providers.find((p) => p.id === id);
  }

  async search(query: string): Promise<Track[]> {
    const cacheKey = RedisKeys.cacheSearch(query);
    const cached = await redis.get(cacheKey);
    if (cached) return JSON.parse(cached) as Track[];
    // cache miss + many controllers typing the same query → one YouTube call
    return this.withSingleFlight(`search:${query}`, async () => {
      const results = (await this.provider("youtube-music")?.search(query)) ?? [];
      if (results.length > 0) await redis.set(cacheKey, JSON.stringify(results), "EX", SEARCH_TTL_SECONDS);
      return results;
    });
  }

  async getTrack(id: string): Promise<Track | null> {
    const cacheKey = RedisKeys.cacheMetadata("youtube-music", id);
    const cached = await redis.get(cacheKey);
    if (cached) return JSON.parse(cached) as Track;
    return this.withSingleFlight(`track:${id}`, async () => {
      const track = (await this.provider("youtube-music")?.getTrack(id)) ?? null;
      if (track) await redis.set(cacheKey, JSON.stringify(track), "EX", METADATA_TTL_SECONDS);
      return track;
    });
  }

  async getAlbum(id: string): Promise<Album | null> {
    return this.cachedMetadata<Album>(`album:${id}`, async () => (await this.provider("youtube-music")?.getAlbum(id)) ?? null);
  }

  async getArtist(id: string): Promise<Artist | null> {
    return this.cachedMetadata<Artist>(`artist:${id}`, async () => (await this.provider("youtube-music")?.getArtist(id)) ?? null);
  }

  async getPlaylist(id: string): Promise<Playlist | null> {
    return this.cachedMetadata<Playlist>(`playlist:${id}`, async () => (await this.provider("youtube-music")?.getPlaylist(id)) ?? null);
  }

  /** Recommended tracks seeded from a track (auto-queue). No cache here — AutoQueueService caches. */
  async getUpNext(trackId: string, limit?: number): Promise<Track[]> {
    return (await this.provider("youtube-music")?.getUpNext(trackId, limit)) ?? [];
  }

  private async cachedMetadata<T>(suffix: string, fetch: () => Promise<T | null>): Promise<T | null> {
    const cacheKey = RedisKeys.cacheMetadata("youtube-music", suffix);
    const cached = await redis.get(cacheKey);
    if (cached) return JSON.parse(cached) as T;
    return this.withSingleFlight(`meta:${suffix}`, async () => {
      const value = await fetch();
      if (value) await redis.set(cacheKey, JSON.stringify(value), "EX", METADATA_TTL_SECONDS);
      return value;
    });
  }
}

export const musicService = new MusicService();
