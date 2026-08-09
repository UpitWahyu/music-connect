import { Innertube } from "youtubei.js";
import type { Track, Album, Artist, Playlist } from "@music-connect/types";
import type { MusicProvider } from "./music-provider.js";

/**
 * YouTube Music provider (PRD §13-§14, Phase 5).
 *
 * Search/metadata only — playback resolution happens on the player via
 * mpv + yt-dlp (PRD §41 D-01), so this class never resolves stream URLs.
 * Raw youtubei.js nodes are normalized into internal DTOs (PRD §14) and
 * never reach the frontend.
 */

/** Normalized shape of a MusicResponsiveListItem (via toJSON). */
interface MusicListItemShape {
  id?: string;
  title?: string;
  artists?: { name: string }[];
  album?: { name?: string };
  thumbnail?: { contents?: { url?: string }[] };
  flex_columns?: { title?: { runs?: { text?: string }[] } }[];
  fixed_columns?: { title?: { text?: string } }[]; // playlist radio items: "6.56"
  duration?: { seconds?: number }; // PlaylistPanelVideo items
}

const MAX_RESULTS = 20; // keep search responses snappy (D-09 cache handles the rest)

function firstThumbUrl(items?: { url?: string }[]): string | undefined {
  return items?.[0]?.url;
}

/** youtubei.js Text nodes serialize to { text, runs } — always reduce to a string. */
function textOf(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "text" in value) {
    return String((value as { text: unknown }).text ?? "");
  }
  return String(value ?? "");
}
/**
 * duration isn't always exposed — parse from (in order): explicit seconds
 * (PlaylistPanelVideo), the subtitle column ("Artist • Album • 3.51" search
 * items, YT Music uses a dot), or the fixed column ("6.56" playlist items).
 */
function parseDurationSeconds(item: MusicListItemShape): number {
  if (item.duration?.seconds && item.duration.seconds > 0) return item.duration.seconds;
  for (const col of item.flex_columns ?? []) {
    const text = (col.title?.runs ?? []).map((r) => r.text ?? "").join("");
    const hms = text.match(/(?:^|\D)(\d{1,2}):(\d{2}):(\d{2})(?:\D|$)/);
    if (hms) return Number(hms[1]) * 3600 + Number(hms[2]) * 60 + Number(hms[3]);
    const ms = text.match(/(?:^|\D)(\d{1,2})[:.](\d{2})(?:\D|$)/);
    if (ms) return Number(ms[1]) * 60 + Number(ms[2]);
  }
  const fixed = item.fixed_columns?.[0]?.title?.text;
  if (fixed) {
    const m = fixed.match(/(\d{1,2})[:.](\d{2})/); // YT Music uses a dot: "6.56"
    if (m) return Number(m[1]) * 60 + Number(m[2]);
  }
  return 0;
}

function normalizeItem(item: unknown): Track | null {
  const plain = JSON.parse(JSON.stringify(item)) as MusicListItemShape;
  if (!plain.id || !plain.title) return null;
  return {
    id: plain.id,
    provider: "youtube-music",
    title: plain.title,
    artist: artistOf(plain),
    album: plain.album?.name,
    duration: parseDurationSeconds(plain),
    thumbnail: firstThumbUrl(plain.thumbnail?.contents),
  };
}

/**
 * Artist name, preferring the dedicated field; falls back to the subtitle
 * column ("The Weeknd • Starboy • 3.51" → "The Weeknd"). Some items (e.g.
 * covers) lack the artists field entirely.
 */
function artistOf(item: MusicListItemShape): string {
  const direct = item.artists?.[0]?.name;
  if (direct) return direct;
  const subtitle = (item.flex_columns?.[1]?.title?.runs ?? []).map((r) => r.text ?? "").join("");
  const first = subtitle.split("•")[0]?.trim();
  return first && first.length > 0 && first.length < 80 ? first : "Unknown";
}

export class YoutubeMusicProvider implements MusicProvider {
  readonly id = "youtube-music";

  private yt: Innertube | null = null;

  private async client(): Promise<Innertube> {
    if (!this.yt) {
      this.yt = await Innertube.create({ lang: "id", retrieve_player: false });
      // TODO Phase 8: if a ProviderAccount with cookies exists, re-create the
      // session with them (PRD §29) — needed for age-restricted content.
    }
    return this.yt;
  }

  async search(query: string): Promise<Track[]> {
    const yt = await this.client();
    const results = await yt.music.search(query, { type: "song" });
    const tracks: Track[] = [];
    for (const section of results.contents ?? []) {
      const shelf = section as { type?: string; contents?: unknown[] };
      if (shelf.type !== "MusicShelf") continue;
      for (const item of shelf.contents ?? []) {
        const node = item as { type?: string };
        if (node.type !== "MusicResponsiveListItem") continue;
        const track = normalizeItem(item);
        if (track) tracks.push(track);
        if (tracks.length >= MAX_RESULTS) break;
      }
      if (tracks.length >= MAX_RESULTS) break;
    }
    return tracks;
  }

  async getTrack(id: string): Promise<Track | null> {
    // Primary path: full metadata via the session. On datacenter IPs YouTube
    // often answers LOGIN_REQUIRED for the player endpoint → falls back to
    // the public oEmbed API below. TODO Phase 8: re-create the session with
    // cookies from ProviderAccount (PRD §29) to unlock full metadata.
    const yt = await this.client();
    try {
      const info = await yt.music.getInfo(id);
      const b = info.basic_info;
      if (b.title && b.id) {
        return {
          id: b.id,
          provider: this.id,
          title: b.title,
          artist: b.author ?? b.channel?.name ?? "Unknown",
          duration: b.duration ?? 0,
          thumbnail: firstThumbUrl(b.thumbnail),
        };
      }
    } catch {
      /* fall through to oEmbed */
    }
    return this.getTrackFromOEmbed(id);
  }

  /** Public oEmbed fallback — no auth, no duration (player reports it). */
  private async getTrackFromOEmbed(id: string): Promise<Track | null> {
    try {
      const res = await fetch(
        `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${encodeURIComponent(id)}&format=json`,
      );
      if (!res.ok) return null;
      const data = (await res.json()) as {
        title?: string;
        author_name?: string;
        thumbnail_url?: string;
      };
      return {
        id,
        provider: this.id,
        title: data.title ?? id,
        artist: data.author_name ?? "Unknown",
        duration: 0, // unknown via oEmbed — the player reports it at playback
        thumbnail: data.thumbnail_url,
      };
    } catch {
      return null; // PRD §31: caller decides (retry / skip / next)
    }
  }

  async getAlbum(id: string): Promise<Album | null> {
    const yt = await this.client();
    try {
      const album = await yt.music.getAlbum(id);
      const header = JSON.parse(JSON.stringify(album.header)) as
        | { title?: string; artist?: { name?: string } }
        | undefined;
      const tracks = album.contents
        .map(normalizeItem)
        .filter((t): t is Track => t !== null);
      return {
        id,
        provider: this.id,
        title: textOf(header?.title) || id,
        artist: textOf(header?.artist?.name) || "Unknown",
        tracks,
      };
    } catch {
      return null;
    }
  }

  async getArtist(id: string): Promise<Artist | null> {
    const yt = await this.client();
    try {
      const artist = await yt.music.getArtist(id);
      const header = JSON.parse(JSON.stringify(artist.header)) as { title?: string } | undefined;
      return { id, provider: this.id, name: textOf(header?.title) || id };
    } catch {
      return null;
    }
  }

  async getPlaylist(id: string): Promise<Playlist | null> {
    const yt = await this.client();
    try {
      const playlist = await yt.music.getPlaylist(id);
      const plain = JSON.parse(JSON.stringify(playlist)) as { title?: string };
      const tracks = playlist.items
        .map(normalizeItem)
        .filter((t): t is Track => t !== null);
      return { id, provider: this.id, title: textOf(plain.title) || id, tracks };
    } catch {
      return null;
    }
  }

  /**
   * Recommended tracks (auto-queue): YT Music's "Up Next" radio, seeded from
   * the currently playing track. The first panel item (selected: true) is the
   * seed itself and is skipped.
   */
  async getUpNext(trackId: string, limit = 20): Promise<Track[]> {
    const yt = await this.client();
    try {
      const panel = await yt.music.getUpNext(trackId, true);
      const tracks: Track[] = [];
      for (const item of panel.contents ?? []) {
        if (item.type !== "PlaylistPanelVideo") continue;
        const plain = JSON.parse(JSON.stringify(item)) as {
          selected?: boolean;
          video_id?: string;
          title?: string;
          artists?: { name?: string }[];
          duration?: { seconds?: number };
        };
        if (plain.selected || !plain.video_id || !plain.title) continue;
        tracks.push({
          id: plain.video_id,
          provider: this.id,
          title: textOf(plain.title),
          artist: plain.artists?.[0]?.name ?? "Unknown",
          duration: plain.duration?.seconds ?? 0,
        });
        if (tracks.length >= limit) break;
      }
      return tracks;
    } catch {
      return []; // recommendations are best-effort — never fail playback
    }
  }
}
