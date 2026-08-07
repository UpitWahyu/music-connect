import type { MediaRef, PlayerStateReport } from "@music-connect/protocol";
import type { PlaybackState } from "@music-connect/types";
import { RedisKeys } from "@music-connect/shared";
import { redis } from "../redis/client.js";
import { sendToPlayer } from "../ws/registry.js";
import { deviceService } from "./device.service.js";

const EMPTY_STATE = (deviceId: string): PlaybackState => ({
  deviceId,
  state: "stopped",
  track: null,
  position: 0,
  volume: 70,
  queueIndex: 0,
  updatedAt: Date.now(),
});

/**
 * Playback orchestration (PRD §23, §26).
 * Commands flow server → player over the player's WebSocket (PRD §41 D-02).
 * Server is authority for queue/track, player is authority for position (D-08).
 */
export class PlaybackService {
  async play(deviceId: string, trackId?: string, media?: MediaRef): Promise<void> {
    if (trackId && media) {
      this.requireOnline(sendToPlayer(deviceId, { type: "player.load", trackId, media }));
    }
    this.requireOnline(sendToPlayer(deviceId, { type: "player.play" }));
    await this.patchState(deviceId, { state: "playing" });
  }

  async pause(deviceId: string): Promise<void> {
    this.requireOnline(sendToPlayer(deviceId, { type: "player.pause" }));
    await this.patchState(deviceId, { state: "paused" });
  }

  async resume(deviceId: string): Promise<void> {
    this.requireOnline(sendToPlayer(deviceId, { type: "player.resume" }));
    await this.patchState(deviceId, { state: "playing" });
  }

  async seek(deviceId: string, position: number): Promise<void> {
    this.requireOnline(sendToPlayer(deviceId, { type: "player.seek", position }));
    await this.patchState(deviceId, { position });
  }

  async setVolume(deviceId: string, volume: number): Promise<void> {
    this.requireOnline(sendToPlayer(deviceId, { type: "player.setVolume", volume }));
    await deviceService.setVolume(deviceId, volume);
    await this.patchState(deviceId, { volume });
  }

  async stop(deviceId: string): Promise<void> {
    this.requireOnline(sendToPlayer(deviceId, { type: "player.stop" }));
    await this.patchState(deviceId, { state: "stopped", position: 0 });
  }

  /** TODO Phase 6: advance queue (auto-next / next / previous) respecting shuffle & repeat. */
  async next(deviceId: string): Promise<void> {
    this.requireOnline(sendToPlayer(deviceId, { type: "player.stop" }));
  }

  async previous(deviceId: string): Promise<void> {
    this.requireOnline(sendToPlayer(deviceId, { type: "player.seek", position: 0 }));
  }

  /**
   * Device handoff (PRD §26, D-11): position carries over, the target
   * device keeps its own volume.
   */
  async transfer(from: string, to: string): Promise<void> {
    const state = await this.getState(from);
    if (!state) throw new Error("NO_STATE");
    if (state.track) {
      const media: MediaRef = { mode: "id", youtubeId: state.track.id };
      this.requireOnline(
        sendToPlayer(to, { type: "player.load", trackId: state.track.id, media, position: state.position }),
      );
      this.requireOnline(sendToPlayer(to, { type: "player.play" }));
    }
    await this.patchState(to, { state: "playing", position: state.position, queueIndex: state.queueIndex });
    this.requireOnline(sendToPlayer(from, { type: "player.stop" }));
    await this.patchState(from, { state: "stopped", position: 0 });
  }

  /** Player-reported state (D-08): player owns position, server keeps track. */
  async applyPlayerReport(deviceId: string, report: PlayerStateReport): Promise<void> {
    const cur = (await this.getState(deviceId)) ?? EMPTY_STATE(deviceId);
    const track = cur.track && cur.track.id === report.trackId ? cur.track : null;
    await this.patchState(deviceId, {
      state: report.status,
      position: report.position,
      volume: report.volume,
      queueIndex: report.queueIndex,
      track,
      updatedAt: report.updatedAt,
    });
  }

  async getState(deviceId: string): Promise<PlaybackState | null> {
    const raw = await redis.get(RedisKeys.deviceState(deviceId));
    return raw ? (JSON.parse(raw) as PlaybackState) : null;
  }

  private async patchState(deviceId: string, patch: Partial<PlaybackState>): Promise<void> {
    const cur = (await this.getState(deviceId)) ?? EMPTY_STATE(deviceId);
    const next: PlaybackState = { ...cur, ...patch, updatedAt: Date.now() };
    await redis.set(RedisKeys.deviceState(deviceId), JSON.stringify(next));
  }

  private requireOnline(sent: boolean): void {
    if (!sent) throw new Error("PLAYER_OFFLINE"); // PRD §31
  }
}

export const playbackService = new PlaybackService();
