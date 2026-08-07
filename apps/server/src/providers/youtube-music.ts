import type { Track, Album, Artist, Playlist } from "@music-connect/types";
import type { MusicProvider } from "./music-provider.js";

/**
 * YouTube Music provider — Phase 5.
 *
 * Search/metadata only, isolated behind MusicProvider so it can be replaced
 * or updated independently (PRD §14). Playback resolution happens on the
 * player via mpv + yt-dlp (PRD §41 D-01), so this class never resolves
 * stream URLs.
 *
 * TODO (Phase 5):
 *  - instantiate youtubei.js (anonymous or with cookies from ProviderAccount)
 *  - implement search() with result normalization (PRD §14 DTO)
 *  - implement getTrack/getAlbum/getArtist/getPlaylist
 *  - respect D-09: metadata cached in Redis (see MusicService)
 */
export class YoutubeMusicProvider implements MusicProvider {
  readonly id = "youtube-music";

  async search(_query: string): Promise<Track[]> {
    return []; // TODO Phase 5
  }

  async getTrack(_id: string): Promise<Track | null> {
    return null; // TODO Phase 5
  }

  async getAlbum(_id: string): Promise<Album | null> {
    return null; // TODO Phase 5
  }

  async getArtist(_id: string): Promise<Artist | null> {
    return null; // TODO Phase 5
  }

  async getPlaylist(_id: string): Promise<Playlist | null> {
    return null; // TODO Phase 5
  }
}
