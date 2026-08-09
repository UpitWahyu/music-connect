import type { MediaRef, PlayerStateReport } from "@music-connect/protocol";
import type { PlaybackState, QueueItem, Track } from "@music-connect/types";
import { RedisKeys } from "@music-connect/shared";
import { redis } from "../redis/client.js";
import { prisma } from "../db/prisma.js";
import { sendToPlayer } from "../ws/registry.js";
import { deviceService } from "./device.service.js";
import { queueService } from "./queue.service.js";
import { musicService } from "./music.service.js";
import { autoQueueService } from "./auto-queue.service.js";

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
 * Auto-next (§25) + auto-queue recommendations keep playback flowing.
 */
export class PlaybackService {
  /** When each device last received a track load (anti auto-next loop). */
  private lastLoadAt = new Map<string, number>();

  async play(deviceId: string, trackId?: string, track?: Track): Promise<void> {
    if (trackId) {
      const item = await queueService.placeCurrent(deviceId, trackId);
      if (item) {
        await this.loadTrack(deviceId, item);
      } else {
        // prefer full metadata from the controller (search result); fall back
        // to provider metadata, then to a bare track (last resort)
        const resolved: Track =
          track ??
          (await musicService.getTrack(trackId)) ?? {
            id: trackId,
            provider: "youtube-music",
            title: trackId,
            artist: "Unknown",
            duration: 0,
          };
        const inserted = await queueService.insertAtCurrent(deviceId, resolved);
        await this.loadTrack(deviceId, inserted);
      }
      // keep the recommendation pipeline fed (auto-queue)
      await autoQueueService.ensure(deviceId, trackId);
      return;
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

  /**
   * Next track (manual or auto via track.ended). Advances the server queue;
   * if the queue is exhausted it refills from recommendations first (§25, auto-queue).
   */
  async next(deviceId: string): Promise<void> {
    let item = await queueService.advance(deviceId);
    if (!item) {
      const state = await this.getState(deviceId);
      await autoQueueService.ensure(deviceId, state?.track?.id ?? null);
      item = await queueService.advance(deviceId);
    }
    if (!item) {
      this.requireOnline(sendToPlayer(deviceId, { type: "player.stop" }));
      await this.patchState(deviceId, { state: "stopped", position: 0 });
      return;
    }
    await this.loadTrack(deviceId, item);
    await autoQueueService.ensure(deviceId, item.track.id);
  }

  async previous(deviceId: string): Promise<void> {
    const index = await queueService.getIndex(deviceId);
    if (index > 0) {
      await queueService.setIndex(deviceId, index - 1);
      const item = await queueService.getCurrent(deviceId);
      if (item) await this.loadTrack(deviceId, item);
    } else {
      // already at the first track — restart it
      this.requireOnline(sendToPlayer(deviceId, { type: "player.seek", position: 0 }));
    }
  }

  /** Player → server: track finished (PRD §25). */
  async onTrackEnded(deviceId: string): Promise<void> {
    // anti-loop: ignore if the track was replaced less than 3s ago (a
    // stale end-file from the previous track must not skip the new one)
    const last = this.lastLoadAt.get(deviceId) ?? 0;
    if (Date.now() - last < 3000) return;
    await this.next(deviceId);
  }

  /**
   * Play a YT Music playlist: replaces the queue with the playlist tracks
   * and starts the first one (Spotify semantics). Returns the queued count.
   */
  async playPlaylist(deviceId: string, playlistId: string): Promise<{ queued: number; first: Track | null }> {
    const playlist = await musicService.getPlaylist(playlistId);
    if (!playlist || playlist.tracks.length === 0) throw new Error("PLAYLIST_NOT_FOUND");
    return this.playTracks(deviceId, playlist.tracks);
  }

  /** Replace the queue with the given tracks and start the first one. */
  async playTracks(deviceId: string, tracks: Track[]): Promise<{ queued: number; first: Track | null }> {
    if (tracks.length === 0) throw new Error("PLAYLIST_NOT_FOUND");

    await queueService.clear(deviceId);
    for (const track of tracks) await queueService.add(deviceId, track);
    await queueService.setIndex(deviceId, 0);

    const first = await queueService.getCurrent(deviceId);
    if (first) {
      await this.loadTrack(deviceId, first);
      await autoQueueService.ensure(deviceId, first.track.id);
    }
    return { queued: tracks.length, first: first?.track ?? null };
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
      await autoQueueService.ensure(to, state.track.id);
    }
    await this.patchState(to, { state: "playing", track: state.track, position: state.position, queueIndex: state.queueIndex });
    this.requireOnline(sendToPlayer(from, { type: "player.stop" }));
    await this.patchState(from, { state: "stopped", position: 0 });
  }

  /** Player-reported state (D-08): player owns position; server keeps queue authority. */
  async applyPlayerReport(deviceId: string, report: PlayerStateReport): Promise<void> {
    const cur = (await this.getState(deviceId)) ?? EMPTY_STATE(deviceId);
    let track = cur.track && cur.track.id === report.trackId ? cur.track : null;
    // authoritative duration from mpv fixes 0:00 (oEmbed tracks have no duration)
    if (track && report.duration && report.duration > 0 && track.duration !== report.duration) {
      track = { ...track, duration: report.duration };
      if (report.trackId) await queueService.updateTrackDuration(deviceId, report.trackId, report.duration);
    }
    await this.patchState(deviceId, {
      state: report.status,
      position: report.position,
      volume: report.volume,
      track,
      updatedAt: report.updatedAt,
    });
  }

  async getState(deviceId: string): Promise<PlaybackState | null> {
    const raw = await redis.get(RedisKeys.deviceState(deviceId));
    return raw ? (JSON.parse(raw) as PlaybackState) : null;
  }

  private async loadTrack(deviceId: string, item: QueueItem): Promise<void> {
    const media: MediaRef = { mode: "id", youtubeId: item.track.id };
    this.requireOnline(sendToPlayer(deviceId, { type: "player.load", trackId: item.track.id, media }));
    this.requireOnline(sendToPlayer(deviceId, { type: "player.play" }));
    await this.patchState(deviceId, {
      state: "playing",
      track: item.track,
      position: 0,
      queueIndex: await queueService.getIndex(deviceId),
    });
    this.lastLoadAt.set(deviceId, Date.now());

    // Playlist-radio items carry no artist — enrich in the background (one
    // oEmbed lookup per track, cached 24h) once playback starts.
    if (!item.track.artist || item.track.artist === "Unknown") {
      void this.enrichTrackMetadata(deviceId, item);
    }

    // Phase 8: record playback history (PRD §29) — device.userId set at pairing
    const device = await prisma.device
      .findUnique({ where: { id: deviceId }, select: { userId: true } })
      .catch(() => null);
    if (device?.userId) {
      await prisma.playbackHistory
        .create({
          data: {
            userId: device.userId,
            deviceId,
            trackId: item.track.id,
            provider: item.track.provider,
            title: item.track.title,
            artist: item.track.artist,
          },
        })
        .catch(() => null);
    }
  }

  /** Background metadata enrichment for tracks missing artist (playlist radio). */
  private async enrichTrackMetadata(deviceId: string, item: QueueItem): Promise<void> {
    try {
      const meta = await musicService.getTrack(item.track.id);
      if (!meta?.artist || meta.artist === "Unknown") return;
      const enriched = {
        title: meta.title && meta.title !== item.track.id ? meta.title : item.track.title,
        artist: meta.artist,
        duration: meta.duration > 0 ? meta.duration : item.track.duration,
      };
      await queueService.updateTrackMetadata(deviceId, item.track.id, enriched);
      const state = await this.getState(deviceId);
      if (state?.track && state.track.id === item.track.id) {
        await this.patchState(deviceId, { track: { ...state.track, ...enriched } });
      }
    } catch {
      // enrichment is best-effort — never fail playback for it
    }
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
