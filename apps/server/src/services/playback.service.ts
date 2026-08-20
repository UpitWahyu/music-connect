import type { MediaRef, PlayerStateReport } from "@music-connect/protocol";
import type { PlaybackState, QueueItem, Track, RepeatMode } from "@music-connect/types";
import { RedisKeys } from "@music-connect/shared";
import { redis } from "../redis/client.js";
import { prisma } from "../db/prisma.js";
import { incCounter } from "../metrics.js";
import { sendToPlayer, broadcastToControllers } from "../ws/registry.js";
import { deviceService } from "./device.service.js";
import { queueService } from "./queue.service.js";
import { musicService } from "./music.service.js";
import { autoQueueService } from "./auto-queue.service.js";

/** 7.2: how long a handoff waits for the target to prove it is playing. */
const HANDOFF_TIMEOUT_MS = Number(process.env.HANDOFF_TIMEOUT_MS ?? 5000);
/** 9: seconds a track must actually play before it counts as history. */
const HISTORY_MIN_SECONDS = Number(process.env.HISTORY_RECORD_SECONDS ?? 10);
/** How many seconds before a track ends the next track is prefetched. */
const PREFETCH_LEAD_MS = Number(process.env.PREFETCH_LEAD_MS ?? 20000);
/** Stream errors tolerated per track before it is skipped. */
const MAX_TRACK_RETRIES = Number(process.env.MAX_TRACK_RETRIES ?? 2);
/** Consecutive failed tracks before playback stops (instead of burning the
 *  whole queue) — signals a broken yt-dlp/network/provider, not a blip. */
const MAX_CONSECUTIVE_ERRORS = 3;

const EMPTY_STATE = (deviceId: string): PlaybackState => ({
  deviceId,
  state: "stopped",
  track: null,
  position: 0,
  volume: 70,
  queueIndex: 0,
  shuffle: false,
  repeat: "off",
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
  /** Per-device in-process mutex for state mutations (4.2). */
  private readonly stateChains = new Map<string, Promise<void>>();
  /** 9: device → trackId already recorded in history (9: threshold-once). */
  private readonly historyRecorded = new Map<string, string>();
  /** deviceId → prefetch timer for the upcoming track (gapless). */
  private readonly prefetchTimers = new Map<string, NodeJS.Timeout>();
  /** deviceId → the pre-picked next track (single source of decision). */
  private readonly pendingNext = new Map<string, { trackId: string; track: Track }>();
  async play(deviceId: string, trackId?: string, track?: Track): Promise<void> {
    incCounter("music_playback_commands_total");
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
    incCounter("music_playback_commands_total");
    this.requireOnline(sendToPlayer(deviceId, { type: "player.pause" }));
    await this.patchState(deviceId, { state: "paused" });
  }

  async resume(deviceId: string): Promise<void> {
    incCounter("music_playback_commands_total");
    this.requireOnline(sendToPlayer(deviceId, { type: "player.resume" }));
    await this.patchState(deviceId, { state: "playing" });
  }

  async seek(deviceId: string, position: number): Promise<void> {
    incCounter("music_playback_commands_total");
    this.requireOnline(sendToPlayer(deviceId, { type: "player.seek", position }));
    await this.patchState(deviceId, { position });
  }

  async setVolume(deviceId: string, volume: number): Promise<void> {
    incCounter("music_playback_commands_total");
    this.requireOnline(sendToPlayer(deviceId, { type: "player.setVolume", volume }));
    await deviceService.setVolume(deviceId, volume);
    await this.patchState(deviceId, { volume });
  }

  /** Toggle shuffle — state only, applied on the next track choice. */
  async setShuffle(deviceId: string, shuffle: boolean): Promise<void> {
    incCounter("music_playback_commands_total");
    await this.patchState(deviceId, { shuffle });
  }

  /** Set repeat mode: "off" | "all" | "one". */
  async setRepeat(deviceId: string, repeat: RepeatMode): Promise<void> {
    incCounter("music_playback_commands_total");
    await this.patchState(deviceId, { repeat });
  }

  async stop(deviceId: string): Promise<void> {
    incCounter("music_playback_commands_total");
    this.clearPrefetchTimer(deviceId);
    this.pendingNext.delete(deviceId);
    void this.finishHistory(deviceId, "STOPPED");
    this.requireOnline(sendToPlayer(deviceId, { type: "player.stop" }));
    await this.patchState(deviceId, { state: "stopped", position: 0 });
  }

  /**
   * Next track (manual or auto via track.ended). Repeat-one replays the
   * current track; shuffle picks a random different track; repeat-all wraps
   * at the end; otherwise advance with auto-queue refill.
   */
  async next(deviceId: string): Promise<void> {
    incCounter("music_playback_commands_total");
    const state = (await this.getState(deviceId)) ?? EMPTY_STATE(deviceId);
    const queue = await queueService.get(deviceId);
    const currentIndex = await queueService.getIndex(deviceId);

    // repeat-one: replay the same track (matches Spotify's manual-next too)
    if (state.repeat === "one") {
      const item = queue[currentIndex] ?? (await queueService.getCurrent(deviceId));
      if (item) {
        await this.loadTrack(deviceId, item);
        await autoQueueService.ensure(deviceId, item.track.id);
        return;
      }
    }

    // gapless: reuse the decision the player is already prefetching — the
    // exact track it has buffered must be the one we load next (never re-pick).
    const pending = this.pendingNext.get(deviceId);
    if (pending) {
      this.pendingNext.delete(deviceId);
      this.clearPrefetchTimer(deviceId);
      const pi = queue.findIndex((x) => x.track.id === pending.trackId);
      if (pi >= 0) {
        await queueService.setIndex(deviceId, pi);
        await this.loadTrack(deviceId, queue[pi]!);
        await autoQueueService.ensure(deviceId, pending.trackId);
        return;
      }
      // pending item vanished from the queue — fall through to normal selection
    }

    // shuffle: pick a different random track from the queue
    if (state.shuffle && queue.length > 1) {
      let target = currentIndex;
      while (target === currentIndex) target = Math.floor(Math.random() * queue.length);
      await queueService.setIndex(deviceId, target);
      const item = queue[target];
      if (item) {
        await this.loadTrack(deviceId, item);
        await autoQueueService.ensure(deviceId, item.track.id);
        return;
      }
    }

    // repeat-all: wrap to the first track at the end
    if (state.repeat === "all" && queue.length > 0 && currentIndex >= queue.length - 1) {
      await queueService.setIndex(deviceId, 0);
      const item = queue[0];
      if (item) {
        await this.loadTrack(deviceId, item);
        await autoQueueService.ensure(deviceId, item.track.id);
        return;
      }
    }

    // normal advance (with auto-queue refill)
    let item = await queueService.advance(deviceId);
    if (!item) {
      await autoQueueService.ensure(deviceId, state.track?.id ?? null);
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
    incCounter("music_playback_commands_total");
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
  async onTrackEnded(deviceId: string, reason: "eof" | "error" = "eof"): Promise<void> {
    incCounter("music_playback_commands_total");
    // anti-loop: ignore if the track was replaced less than 3s ago (a
    // stale end-file from the previous track must not skip the new one)
    const last = this.lastLoadAt.get(deviceId) ?? 0;
    if (Date.now() - last < 3000) return;
    // P2: a natural end closes the history entry as COMPLETED
    if (reason === "eof") void this.finishHistory(deviceId, "COMPLETED");
    // stream failure (Termux / weak WiFi / YouTube throttle): retry the SAME
    // track a few times before giving up and advancing — the user asked for
    // this song, a transient network blip must not skip it
    if (reason === "error") {
      const retried = await this.retryTrack(deviceId);
      if (retried) return;
      // gave up on this track. After MAX_CONSECUTIVE_ERRORS tracks fail in a
      // row something is broken (yt-dlp, network, provider) — stop instead of
      // silently burning through the whole queue, and tell the controllers.
      const streak = (this.errorStreak.get(deviceId) ?? 0) + 1;
      this.errorStreak.set(deviceId, streak);
      if (streak >= MAX_CONSECUTIVE_ERRORS) {
        this.errorStreak.delete(deviceId);
        this.clearPrefetchTimer(deviceId);
        this.pendingNext.delete(deviceId);
        this.trackRetries.delete(deviceId);
        await this.patchState(deviceId, { state: "stopped", position: 0 });
        broadcastToControllers({ type: "playback.error", deviceId, message: "STREAM_FAILED" });
        return; // do NOT burn the rest of the queue
      }
    } else {
      this.errorStreak.delete(deviceId); // a natural end = healthy playback
      // gapless v2: the player's mpv ALREADY switched to the appended entry
      // (prefetch) — adopt it in server state WITHOUT sending player.load
      // (a load would restart the track that just began playing).
      const pending = this.pendingNext.get(deviceId);
      if (pending) {
        const queue = await queueService.get(deviceId);
        const pi = queue.findIndex((x) => x.track.id === pending.trackId);
        if (pi >= 0) {
          this.pendingNext.delete(deviceId);
          this.clearPrefetchTimer(deviceId);
          this.trackRetries.delete(deviceId);
          await queueService.setIndex(deviceId, pi);
          await this.patchState(deviceId, { track: queue[pi]!.track, state: "playing", position: 0 });
          this.historyRecorded.delete(deviceId);
          void autoQueueService.ensure(deviceId, pending.trackId);
          this.schedulePrefetch(deviceId, queue[pi]!.track);
          return;
        }
        // pending item vanished from the queue — fall through to next()
      }
    }
    await this.next(deviceId);
  }

  /** deviceId → per-track stream-error retry budget. */
  private readonly trackRetries = new Map<string, { trackId: string; count: number }>();
  /** deviceId → consecutive failed tracks (stops playback at threshold). */
  private readonly errorStreak = new Map<string, number>();

  private async retryTrack(deviceId: string): Promise<boolean> {
    const st = (await this.getState(deviceId)) ?? EMPTY_STATE(deviceId);
    if (!st.track) return false;
    const cur = this.trackRetries.get(deviceId);
    const count = cur && cur.trackId === st.track.id ? cur.count : 0;
    if (count >= MAX_TRACK_RETRIES) return false; // give up — advance to the next
    this.trackRetries.set(deviceId, { trackId: st.track.id, count: count + 1 });
    // reload from the queue position when possible; direct-play tracks have no
    // queue entry so fall back to the in-memory track payload
    const queue = await queueService.get(deviceId);
    const idx = await queueService.getIndex(deviceId);
    const item =
      queue[idx] && queue[idx]!.track.id === st.track.id
        ? queue[idx]!
        : ({ id: `retry-${st.track.id}`, track: st.track } as QueueItem);
    await this.loadTrack(deviceId, item, true); // retry: keep the budget
    return true;
  }

  /**
   * Play a YT Music playlist: replaces the queue with the playlist tracks
   * and starts the first one (Spotify semantics). Returns the queued count.
   */
  async playPlaylist(deviceId: string, playlistId: string): Promise<{ queued: number; first: Track | null }> {
    incCounter("music_playback_commands_total");
    const playlist = await musicService.getPlaylist(playlistId);
    if (!playlist || playlist.tracks.length === 0) throw new Error("PLAYLIST_NOT_FOUND");
    return this.playTracks(deviceId, playlist.tracks);
  }

  /** Replace the queue with the given tracks and start the first one. */
  async playTracks(deviceId: string, tracks: Track[]): Promise<{ queued: number; first: Track | null }> {
    incCounter("music_playback_commands_total");
    if (tracks.length === 0) throw new Error("PLAYLIST_NOT_FOUND");

    // P1: one atomic queue mutation (replace + cursor=0) — no interleaving
    // with other controllers' adds/reorders mid-replacement
    await queueService.replace(deviceId, tracks, 0);

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
    incCounter("music_playback_commands_total");
    incCounter("music_handoff_total");
    const state = await this.getState(from);
    if (!state?.track) throw new Error("NOTHING_TO_TRANSFER"); // never clobber the target's state
    const media: MediaRef = { mode: "id", youtubeId: state.track.id };
    const volume = await deviceService.getVolume(to); // D-10: target keeps its own volume
    this.requireOnline(
      sendToPlayer(to, { type: "player.load", trackId: state.track.id, media, position: state.position, volume }),
    );
    this.requireOnline(sendToPlayer(to, { type: "player.play" }));
    await autoQueueService.ensure(to, state.track.id);
    // expose the track metadata on the target immediately (UI shows it), but do
    // NOT mark it "playing" — only the target's own report proves that (7.1).
    await this.patchState(to, { track: state.track, position: state.position, queueIndex: state.queueIndex });
    const started = await this.waitForTarget(to, HANDOFF_TIMEOUT_MS);
    if (!started) {
      sendToPlayer(to, { type: "player.stop" });
      await this.patchState(to, { state: "stopped", position: 0, track: null });
      incCounter("music_handoff_failure_total");
      throw new Error("HANDOFF_FAILED");
    }
    incCounter("music_handoff_success_total");
    this.requireOnline(sendToPlayer(from, { type: "player.stop" }));
    await this.patchState(from, { state: "stopped", position: 0 });
  }

  private async waitForTarget(deviceId: string, timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const st = await this.getState(deviceId);
      if (st?.state === "playing") return true; // target's own report
      await new Promise((r) => setTimeout(r, 250));
    }
    return false;
  }

  /** Player-reported state (D-08): player owns position; server keeps queue authority. */
  async applyPlayerReport(deviceId: string, report: PlayerStateReport): Promise<void> {
    const cur = (await this.getState(deviceId)) ?? EMPTY_STATE(deviceId);
    let track = cur.track && cur.track.id === report.trackId ? cur.track : null;
    // self-heal: if the state lost its track (e.g. a bad transfer), restore it
    // from the queue using the id the player reports
    if (!track && report.trackId) {
      const item = (await queueService.get(deviceId)).find((i) => i.track.id === report.trackId);
      if (item) track = item.track;
    }
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
    // 9: record history once the track has actually played ≥ threshold
    // (10s, or 10% of a short track) — a load that fails to start never counts.
    if (report.status === "playing" && report.trackId && this.historyRecorded.get(deviceId) !== report.trackId) {
      const duration = track?.duration ?? report.duration ?? 0;
      const threshold = duration > 0 ? Math.min(HISTORY_MIN_SECONDS, duration * 0.1) : HISTORY_MIN_SECONDS;
      if (report.position >= threshold) {
        this.historyRecorded.set(deviceId, report.trackId);
        const device = await prisma.device
          .findUnique({ where: { id: deviceId }, select: { userId: true } })
          .catch(() => null);
        if (device?.userId) {
          await prisma.playbackHistory
            .create({
              data: {
                userId: device.userId,
                deviceId,
                trackId: report.trackId,
                provider: "youtube-music",
                title: track?.title ?? "",
                artist: track?.artist ?? "",
                playedSeconds: Math.round(report.position ?? 0),
              },
            })
            .catch(() => null);
        }
      }
    }
  }

  /**
   * Player disconnected and stayed offline past the grace window: park the
   * playback state as paused (no player command — it's offline), keeping the
   * last track + position so a resume / reconnect restores it.
   */
  async pauseOnDisconnect(deviceId: string): Promise<void> {
    const st = await this.getState(deviceId);
    if (!st || st.state !== "playing") return;
    await this.patchState(deviceId, { state: "paused", position: st.position, updatedAt: Date.now() });
  }

  // --- gapless prefetch (player.prefetch / player.prefetchClear) ---

  private clearPrefetchTimer(deviceId: string): void {
    const t = this.prefetchTimers.get(deviceId);
    if (t) clearTimeout(t);
    this.prefetchTimers.delete(deviceId);
  }

  /**
   * Decide which track plays next *right now* (same rules as next(): shuffle
   * random-different, repeat-all wrap, else linear index+1). The result is
   * stored as pendingNext so the decision the player buffers is the one used.
   */
  private pickNext(
    queue: QueueItem[],
    currentIndex: number,
    state: Pick<PlaybackState, "shuffle" | "repeat">,
  ): { item: QueueItem; index: number } | null {
    if (state.repeat === "one") return null; // replaying the same track — nothing to prefetch
    if (state.shuffle && queue.length > 1) {
      let target = currentIndex;
      while (target === currentIndex) target = Math.floor(Math.random() * queue.length);
      return { item: queue[target]!, index: target };
    }
    if (state.repeat === "all" && queue.length > 0 && currentIndex >= queue.length - 1) {
      return { item: queue[0]!, index: 0 };
    }
    const nextIndex = currentIndex + 1;
    if (nextIndex < queue.length) return { item: queue[nextIndex]!, index: nextIndex };
    return null; // queue exhausted (auto-queue may refill later)
  }

  /**
   * Schedule player.prefetch for the upcoming track so mpv buffers it before
   * the current one ends (gapless). Skipped when: repeat-one, unknown track
   * duration, no next track, or the player is offline.
   */
  private schedulePrefetch(deviceId: string, currentTrack: Track): void {
    // opt-out (PREFETCH_ENABLED=false): weak devices (Termux/Android) may
    // choke on mpv playlist prefetching — skip it entirely
    if (process.env.PREFETCH_ENABLED === "false") return;
    this.clearPrefetchTimer(deviceId);
    this.pendingNext.delete(deviceId);
    if (!currentTrack.duration || currentTrack.duration <= 0) return;
    void (async () => {
      const st = (await this.getState(deviceId)) ?? EMPTY_STATE(deviceId);
      if (st.state !== "playing") return;
      if (st.repeat === "one") return;
      const queue = await queueService.get(deviceId);
      const next = this.pickNext(queue, await queueService.getIndex(deviceId), st);
      if (!next) return;
      // pendingNext is set ONLY when the prefetch actually fires — a natural
      // end before that falls back to a regular (loading) next().
      const lead = Number(process.env.PREFETCH_LEAD_MS ?? PREFETCH_LEAD_MS);
      const delay = Math.max(0, (currentTrack.duration - lead / 1000) * 1000);
      const timer = setTimeout(() => {
        this.pendingNext.set(deviceId, { trackId: next.item.track.id, track: next.item.track });
        if (!sendToPlayer(deviceId, { type: "player.prefetch", trackId: next.item.track.id, media: { mode: "id", youtubeId: next.item.track.id } })) {
          // player offline — drop the pending prefetch silently
          this.pendingNext.delete(deviceId);
        }
      }, delay);
      timer.unref?.();
      this.prefetchTimers.set(deviceId, timer);
    })().catch(() => null);
  }

  /**
   * Queue changed (add/remove/reorder/clear) or playback was intervened:
   * cancel any in-flight prefetch so mpv never plays a track the user no
   * longer expects, then re-pick for the current track.
   */
  async invalidatePrefetch(deviceId: string): Promise<void> {
    this.clearPrefetchTimer(deviceId);
    this.pendingNext.delete(deviceId);
    sendToPlayer(deviceId, { type: "player.prefetchClear" });
    const st = (await this.getState(deviceId)) ?? EMPTY_STATE(deviceId);
    if (st.state === "playing" && st.track) this.schedulePrefetch(deviceId, st.track);
  }

  /**
   * P2: close the device's most recent open history entry (the one currently
   * playing) with a completion reason + how much of it actually played.
   * Entries already closed (COMPLETED/SKIPPED/STOPPED) are never touched.
   */
  private async finishHistory(deviceId: string, reason: "COMPLETED" | "SKIPPED" | "STOPPED"): Promise<void> {
    try {
      const last = await prisma.playbackHistory.findFirst({
        where: { deviceId, completionReason: null },
        orderBy: { playedAt: "desc" },
        select: { id: true },
      });
      if (!last) return;
      const st = (await this.getState(deviceId)) ?? EMPTY_STATE(deviceId);
      await prisma.playbackHistory.update({
        where: { id: last.id },
        data: { completionReason: reason, playedSeconds: Math.round(st.position ?? 0) },
      });
    } catch {
      // history is best-effort — never fail playback for it
    }
  }

  async getState(deviceId: string): Promise<PlaybackState | null> {
    const raw = await redis.get(RedisKeys.deviceState(deviceId));
    return raw ? (JSON.parse(raw) as PlaybackState) : null;
  }

  private async loadTrack(deviceId: string, item: QueueItem, fromRetry = false): Promise<void> {
    // any new load that is NOT a stream-error retry resets the per-track
    // retry budget (play/next/previous/transfer all start a fresh attempt)
    if (!fromRetry) this.trackRetries.delete(deviceId);
    // P2: the previous track's history entry is closed when playback moves on
    // (a completed entry is already COMPLETED and is left untouched)
    const prev = await this.getState(deviceId);
    if (!fromRetry && prev?.track) void this.finishHistory(deviceId, "SKIPPED");
    const media: MediaRef = { mode: "id", youtubeId: item.track.id };
    const volume = await deviceService.getVolume(deviceId);
    this.requireOnline(sendToPlayer(deviceId, { type: "player.load", trackId: item.track.id, media, volume }));
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

    // Phase 9: history is recorded once the track actually plays ≥ threshold
    // (in applyPlayerReport) — not on load (a yt-dlp failure must not count)
    this.historyRecorded.delete(deviceId);
    // gapless: pre-pick the next track now and schedule player.prefetch so the
    // player buffers it before this track ends
    this.schedulePrefetch(deviceId, item.track);
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
    // 4.2: serialize mutations per device (in-process mutex). GET→merge→SET
    // races (position report vs pause vs volume) would otherwise lose fields.
    const prev = this.stateChains.get(deviceId) ?? Promise.resolve();
    const run = async (): Promise<void> => {
      const cur = (await this.getState(deviceId)) ?? EMPTY_STATE(deviceId);
      const next: PlaybackState = { ...cur, ...patch, updatedAt: Date.now() };
      await redis.set(RedisKeys.deviceState(deviceId), JSON.stringify(next));
      // hybrid realtime: push state to every controller; REST stays for commands.
      // Player reports arrive ~1/s so this is naturally throttled.
      broadcastToControllers({ type: "player.state", deviceId, state: next });
    };
    const chained = prev.then(run, run);
    this.stateChains.set(deviceId, chained.catch(() => undefined));
    await chained;
  }

  private requireOnline(sent: boolean): void {
    if (!sent) throw new Error("PLAYER_OFFLINE"); // PRD §31
  }
}

export const playbackService = new PlaybackService();
