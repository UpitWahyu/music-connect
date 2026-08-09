/**
 * Wire protocol shared by server, player agent and controllers.
 * Single source of truth so event schemas never diverge (PRD §38).
 */
import type { PlaybackStatus, QueueItem } from "@music-connect/types";

/** Dual-mode media reference (PRD §41 D-01). */
export type MediaRef =
  | { mode: "id"; youtubeId: string } // mpv + yt-dlp resolves (V1: desktop & Termux)
  | { mode: "url"; url: string }; // server-provided stream URL (future: native Android)

/** Player → Server state report. Server merges metadata into PlaybackState. */
export interface PlayerStateReport {
  deviceId: string;
  status: PlaybackStatus;
  trackId: string | null;
  position: number;
  duration?: number; // actual track duration from mpv — fixes 0:00 for oEmbed tracks
  volume: number;
  queueIndex: number;
  updatedAt: number;
}

/**
 * Server → Player commands.
 * Delivered over the player's WebSocket connection (PRD §41 D-02).
 */
export type PlayerCommand =
  | { type: "player.load"; trackId: string; media: MediaRef; position?: number; volume?: number }
  | { type: "player.play" }
  | { type: "player.pause" }
  | { type: "player.resume" }
  | { type: "player.seek"; position: number }
  | { type: "player.setVolume"; volume: number }
  | { type: "player.stop" };

/** Player → Server events. */
export type PlayerEvent =
  | { type: "player.heartbeat"; deviceId: string; position: number; status: PlaybackStatus }
  | { type: "player.state"; report: PlayerStateReport }
  | { type: "player.trackEnded"; deviceId: string }
  | { type: "player.error"; code: string; message: string };

/** Client (controller) → Server events (PRD §22). */
export type ClientEvent =
  | { type: "device.register"; deviceId: string }
  | { type: "player.play"; deviceId: string; trackId?: string }
  | { type: "player.pause"; deviceId: string }
  | { type: "player.resume"; deviceId: string }
  | { type: "player.seek"; deviceId: string; position: number }
  | { type: "player.next"; deviceId: string }
  | { type: "player.previous"; deviceId: string }
  | { type: "player.volume"; deviceId: string; volume: number }
  | { type: "device.transfer"; from: string; to: string };

/** Server → Client (controller) events (PRD §22). */
export type ServerEvent =
  | { type: "player.state"; deviceId: string; state: unknown }
  | { type: "device.updated"; device: unknown }
  | { type: "queue.updated"; deviceId: string; queue: QueueItem[] }
  | { type: "error"; code: string; message: string };

/** First-message auth (PRD §41 D-07) — token never travels in the query string. */
export interface AuthMessage {
  type: "auth";
  token: string;
}

export interface PlayerAuthMessage {
  type: "player.auth";
  deviceId: string;
  token: string;
}

export interface PlayerReadyMessage {
  type: "player.ready";
}
