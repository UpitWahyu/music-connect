import type { Track, Album, Artist, Playlist } from "@music-connect/types";
import type { MusicProvider } from "./music-provider.js";
import { incCounter } from "../metrics.js";

/**
 * Provider resilience wrapper (10.1, 10.2, 10.3):
 * - every provider call has a hard timeout (default 15s) — YouTube requests
 *   must never hang the server
 * - circuit breaker: 5 consecutive failures → OPEN for 30s (fast-fail
 *   PROVIDER_UNAVAILABLE), then HALF_OPEN → a success closes it again
 * - Prometheus counters for requests/errors/timeouts
 */
const PROVIDER_TIMEOUT_MS = Number(process.env.PROVIDER_TIMEOUT_MS ?? 15000);
const BREAK_THRESHOLD = Number(process.env.PROVIDER_BREAK_THRESHOLD ?? 5);
const BREAK_MS = Number(process.env.PROVIDER_BREAK_MS ?? 30000);

export class ResilientProvider implements MusicProvider {
  readonly id: string;
  private failures = 0;
  private openUntil = 0;
  private readonly inner: MusicProvider;

  constructor(inner: MusicProvider) {
    this.inner = inner;
    this.id = inner.id;
  }

  private get isOpen(): boolean {
    return Date.now() < this.openUntil;
  }

  private withTimeout<T>(fn: () => Promise<T>): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    const timeoutP = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("PROVIDER_TIMEOUT")), PROVIDER_TIMEOUT_MS);
    });
    return Promise.race([fn(), timeoutP]).finally(() => {
      if (timer) clearTimeout(timer);
    });
  }

  private run<T>(name: string, fn: () => Promise<T>): Promise<T> {
    incCounter("music_provider_requests_total");
    if (this.isOpen) {
      incCounter("music_provider_errors_total");
      return Promise.reject(new Error("PROVIDER_UNAVAILABLE"));
    }
    return this.withTimeout(fn)
      .then((result) => {
        this.failures = 0; // success closes the circuit
        this.openUntil = 0;
        return result;
      })
      .catch((e: Error) => {
        this.failures++;
        incCounter("music_provider_errors_total");
        if (e.message === "PROVIDER_TIMEOUT") incCounter("music_provider_timeouts_total");
        if (this.failures >= BREAK_THRESHOLD) this.openUntil = Date.now() + BREAK_MS;
        throw e;
      });
  }

  search(query: string): Promise<Track[]> {
    return this.run("search", () => this.inner.search(query));
  }

  getTrack(id: string): Promise<Track | null> {
    return this.run("getTrack", () => this.inner.getTrack(id));
  }

  getAlbum(id: string): Promise<Album | null> {
    return this.run("getAlbum", () => this.inner.getAlbum(id));
  }

  getArtist(id: string): Promise<Artist | null> {
    return this.run("getArtist", () => this.inner.getArtist(id));
  }

  getPlaylist(id: string): Promise<Playlist | null> {
    return this.run("getPlaylist", () => this.inner.getPlaylist(id));
  }

  getUpNext(trackId: string, limit?: number): Promise<Track[]> {
    return this.run("getUpNext", () => this.inner.getUpNext(trackId, limit));
  }
}
