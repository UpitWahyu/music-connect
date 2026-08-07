/**
 * Domain entities shared across server / player / web.
 * Only stable, provider-agnostic shapes live here.
 */

/** Normalized music track (PRD §14) — never a raw youtubei.js object. */
export interface Track {
  id: string; // stable provider id, e.g. YouTube video id
  provider: string; // e.g. "youtube-music"
  title: string;
  artist: string;
  album?: string;
  duration: number; // seconds
  thumbnail?: string;
}

export interface Album {
  id: string;
  provider: string;
  title: string;
  artist: string;
  year?: number;
  tracks: Track[];
  thumbnail?: string;
}

export interface Artist {
  id: string;
  provider: string;
  name: string;
  thumbnail?: string;
}

export interface Playlist {
  id: string;
  provider: string;
  title: string;
  tracks: Track[];
  thumbnail?: string;
}

export type DeviceType = "desktop" | "android" | "tv" | "browser" | "unknown";

/** Persistent device record (PRD §9). Runtime presence lives in Redis. */
export interface Device {
  id: string;
  name: string;
  type: DeviceType;
  tokenHash: string;
  lastSeen: Date | null;
  online: boolean;
  volume: number;
  createdAt: Date;
  updatedAt: Date;
}

export type PlaybackStatus = "playing" | "paused" | "stopped" | "offline";

/** Playback state snapshot stored in Redis (PRD §16). */
export interface PlaybackState {
  deviceId: string;
  state: PlaybackStatus;
  track: Track | null;
  position: number; // seconds
  volume: number;
  queueIndex: number;
  updatedAt: number; // epoch ms
}

/** Server-managed queue item (PRD §24). Identified by item id, never index. */
export interface QueueItem {
  id: string; // item id (uuid) — stable across reorders
  track: Track;
  addedBy: string;
}
