import type { MediaRef, PlayerStateReport } from "@music-connect/protocol";
import type { PlaybackStatus } from "@music-connect/types";

/**
 * Player-side state (PRD §16, D-08).
 * The player owns position/status; the server owns queue & track metadata.
 */
export class PlayerState {
  private trackId: string | null = null;
  private media: MediaRef | null = null;

  status: PlaybackStatus = "stopped";
  position = 0;
  duration = 0; // authoritative duration, synced from mpv
  volume = 70;
  queueIndex = 0;

  setTrack(trackId: string, media: MediaRef): void {
    this.trackId = trackId;
    this.media = media;
    this.position = 0;
    this.duration = 0;
    this.status = "playing";
  }

  currentTrackId(): string | null {
    return this.trackId;
  }

  toReport(deviceId: string, now: number = Date.now()): PlayerStateReport {
    return {
      deviceId,
      status: this.status,
      trackId: this.trackId,
      position: this.position,
      duration: this.duration,
      volume: this.volume,
      queueIndex: this.queueIndex,
      updatedAt: now,
    };
  }
}
