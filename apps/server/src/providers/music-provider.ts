import type { Track, Album, Artist, Playlist } from "@music-connect/types";

/**
 * Music provider abstraction (PRD §13).
 * Providers must normalize everything into internal DTOs — raw youtubei.js
 * objects never reach the frontend (PRD §14).
 */
export interface MusicProvider {
  readonly id: string;
  search(query: string): Promise<Track[]>;
  getTrack(id: string): Promise<Track | null>;
  getAlbum(id: string): Promise<Album | null>;
  getArtist(id: string): Promise<Artist | null>;
  getPlaylist(id: string): Promise<Playlist | null>;
  /** Recommended tracks seeded from a track (auto-queue feature). */
  getUpNext(trackId: string, limit?: number): Promise<Track[]>;
}
