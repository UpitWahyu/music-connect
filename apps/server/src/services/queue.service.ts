import { randomUUID } from "node:crypto";
import type { QueueItem, Track } from "@music-connect/types";
import { RedisKeys } from "@music-connect/shared";
import { redis } from "../redis/client.js";
import { incCounter } from "../metrics.js";
import { prisma } from "../db/prisma.js";

/**
 * Server-controlled queue (PRD §24). Ephemeral — Redis only (PRD §41 D-05).
 * Items are identified by their stable item id, never by index (see §41).
 * The current position (queueIndex) is server-authoritative (D-08).
 *
 * The queue is **global per account**: every device of the same user shares
 * one queue (Spotify-like). Devices paired without a user (test rigs) fall
 * back to a per-device queue keyed by their id.
 *
 * All mutations go through `mutate()` which uses Redis WATCH/MULTI (optimistic
 * locking) so concurrent controllers can never lose each other's updates.
 */
export class QueueService {
  /** device → owning userId. Cached with a TTL — pairing may set userId AFTER
   *  the first lookup (a null-user device becomes a real account device). */
  private ownerCache = new Map<string, { owner: string; at: number }>();
  private static OWNER_TTL_MS = 30_000;

  private async ownerOf(deviceId: string): Promise<string> {
    const cached = this.ownerCache.get(deviceId);
    if (cached && Date.now() - cached.at < QueueService.OWNER_TTL_MS) return cached.owner;
    const dev = await prisma.device.findUnique({ where: { id: deviceId }, select: { userId: true } });
    const owner = dev?.userId ?? deviceId;
    this.ownerCache.set(deviceId, { owner, at: Date.now() });
    return owner;
  }

  private keyOf(owner: string, index = false): string {
    return index ? RedisKeys.userQueueIndex(owner) : RedisKeys.userQueue(owner);
  }

  /**
   * Read-modify-write with a per-key distributed lock (SET NX + TTL).
   * ioredis WATCH does not apply to multi() transactions (separate pipeline
   * connection), so a lock is the reliable way to serialize mutations.
   * Lock release is token-checked (Lua) so a stale release can't unlock
   * someone else's critical section. Retries on contention.
   */
  private static RELEASE_LUA = `
    if redis.call('get', KEYS[1]) == ARGV[1] then
      return redis.call('del', KEYS[1])
    else
      return 0
    end
  `;

  private async mutate(deviceId: string, fn: (q: QueueItem[]) => QueueItem[]): Promise<QueueItem[]> {
    return this.mutateWithCursor(deviceId, (queue, _index) => ({ queue: fn(queue), index: _index })).then((r) => r.queue);
  }

  /**
   * Read-modify-write of queue AND cursor under ONE distributed lock (P1):
   * cursor-dependent operations (play-next, insert-at-current, clear,
   * replace) can never observe a cursor that another mutation is changing.
   */
  private async mutateWithCursor(
    deviceId: string,
    fn: (q: QueueItem[], index: number) => { queue: QueueItem[]; index: number },
  ): Promise<{ queue: QueueItem[]; index: number }> {
    const owner = await this.ownerOf(deviceId);
    const key = this.keyOf(owner);
    const indexKey = this.keyOf(owner, true);
    const lockKey = `${key}:lock`;
    const token = randomUUID();
    for (let attempt = 0; attempt < 50; attempt++) {
      const acquired = await redis.set(lockKey, token, "EX", 5, "NX");
      if (acquired) {
        try {
          const queue = await this.get(deviceId);
          const index = Number((await redis.get(indexKey)) ?? "0");
          const result = fn(queue, index);
          await redis.set(key, JSON.stringify(result.queue));
          await redis.set(indexKey, String(result.index));
          incCounter("music_queue_mutations_total");
          return result;
        } finally {
          await redis
            .eval(QueueService.RELEASE_LUA, 1, lockKey, token)
            .catch(() => null);
        }
      }
      // backoff: 5, 7, 9, … capped — long enough for many contenders
      await new Promise((r) => setTimeout(r, Math.min(5 + attempt * 2, 100)));
    }
    throw new Error("QUEUE_CONFLICT");
  }

  async get(deviceId: string): Promise<QueueItem[]> {
    const owner = await this.ownerOf(deviceId);
    const raw = await redis.get(this.keyOf(owner));
    return raw ? (JSON.parse(raw) as QueueItem[]) : [];
  }

  async set(deviceId: string, items: QueueItem[]): Promise<QueueItem[]> {
    return this.mutate(deviceId, () => items);
  }

  async add(deviceId: string, track: Track, position?: "next"): Promise<QueueItem[]> {
    const item: QueueItem = { id: randomUUID(), track, addedBy: "user" };
    if (position === "next") {
      // "Play next": insert right after the current track. Cursor-aware AND
      // atomic — cursor + queue are read/written under the same lock, so a
      // concurrent advance() can never shift the insert position (P1).
      return this.mutateWithCursor(deviceId, (queue, index) => {
        const next = [...queue];
        next.splice(Math.min(index + 1, next.length), 0, item);
        return { queue: next, index };
      }).then((r) => r.queue);
    }
    return this.mutate(deviceId, (queue) => {
      queue.push(item);
      return queue;
    });
  }

  /** Auto-queued recommendations are marked addedBy: "auto". */
  async addAuto(deviceId: string, track: Track): Promise<QueueItem[]> {
    const item: QueueItem = { id: randomUUID(), track, addedBy: "auto" };
    return this.mutate(deviceId, (queue) => {
      queue.push(item);
      return queue;
    });
  }

  async remove(deviceId: string, itemId: string): Promise<QueueItem[]> {
    return this.mutate(deviceId, (queue) => queue.filter((i) => i.id !== itemId));
  }

  /** Atomic clear: queue = [] AND cursor = 0 in one critical section (P1). */
  async clear(deviceId: string): Promise<QueueItem[]> {
    const { queue } = await this.mutateWithCursor(deviceId, () => ({ queue: [], index: 0 }));
    return queue;
  }

  /** Atomic replace (P1): swap the whole queue and reset the cursor in ONE
   *  lock — used by playTracks so playlist playback cannot interleave with
   *  other mutations. */
  async replace(deviceId: string, tracks: Track[], index = 0): Promise<QueueItem[]> {
    const { queue } = await this.mutateWithCursor(deviceId, (current) => ({
      queue: tracks.map((track) => ({ id: randomUUID(), track, addedBy: "user" as const })),
      index: Math.min(index, Math.max(0, tracks.length - 1)),
    }));
    return queue;
  }

  /** Player-reported authoritative duration (D-08) — fixes 0:00 tracks. */
  async updateTrackDuration(deviceId: string, trackId: string, duration: number): Promise<void> {
    await this.updateTrackMetadata(deviceId, trackId, { duration });
  }

  /** Patch a queue item's track metadata (duration, artist, thumbnail…). */
  async updateTrackMetadata(deviceId: string, trackId: string, patch: Partial<Track>): Promise<void> {
    await this.mutate(deviceId, (queue) => {
      const item = queue.find((i) => i.track.id === trackId);
      if (item) item.track = { ...item.track, ...patch };
      return queue;
    });
  }

  /** Reorder the queue by a client-supplied list of item ids (must cover all items). */
  async reorder(deviceId: string, order: string[]): Promise<QueueItem[]> {
    return this.mutate(deviceId, (queue) => {
      if (order.length !== queue.length) throw new Error("ORDER_MISMATCH");
      const byId = new Map(queue.map((i) => [i.id, i]));
      const reordered: QueueItem[] = [];
      for (const id of order) {
        const item = byId.get(id);
        if (!item) throw new Error("ORDER_INVALID");
        reordered.push(item);
      }
      return reordered;
    });
  }

  // --- current position (server-authoritative, D-08) ---

  async getIndex(deviceId: string): Promise<number> {
    const owner = await this.ownerOf(deviceId);
    const raw = await redis.get(this.keyOf(owner, true));
    return raw ? Number(raw) : 0;
  }

  async setIndex(deviceId: string, index: number): Promise<void> {
    const owner = await this.ownerOf(deviceId);
    await redis.set(this.keyOf(owner, true), String(index));
  }

  async getCurrent(deviceId: string): Promise<QueueItem | null> {
    const queue = await this.get(deviceId);
    return queue[(await this.getIndex(deviceId))] ?? null;
  }

  /** Advance to the next item. Returns null when the queue is exhausted.
   * Atomic (4.1): queue + cursor are read and written under the same
   * distributed lock, so concurrent next() calls can never lose an increment. */
  async advance(deviceId: string): Promise<QueueItem | null> {
    const owner = await this.ownerOf(deviceId);
    const key = this.keyOf(owner);
    const indexKey = this.keyOf(owner, true);
    const lockKey = `${key}:lock`;
    const token = randomUUID();
    for (let attempt = 0; attempt < 500; attempt++) {
      const acquired = await redis.set(lockKey, token, "EX", 5, "NX");
      if (acquired) {
        try {
          const queue = await this.get(deviceId);
          const idx = Number((await redis.get(indexKey)) ?? "0");
          const next = idx + 1;
          if (next >= queue.length) return null;
          await redis.set(indexKey, String(next));
          incCounter("music_queue_mutations_total");
          return queue[next] ?? null;
        } finally {
          await redis.eval(QueueService.RELEASE_LUA, 1, lockKey, token).catch(() => null);
        }
      }
      // short fixed backoff — with many contenders the last one wins in ~N×6ms
      await new Promise((r) => setTimeout(r, 5));
    }
    throw new Error("QUEUE_LOCK_TIMEOUT");
  }

  /** Move the cursor to an existing track, or null if it's not in the queue.
   *  Atomic: cursor + queue under one lock — never points at a stale index. */
  async placeCurrent(deviceId: string, trackId: string): Promise<QueueItem | null> {
    const { queue, index } = await this.mutateWithCursor(deviceId, (q, i) => {
      const idx = q.findIndex((item) => item.track.id === trackId);
      return { queue: q, index: idx >= 0 ? idx : i };
    });
    // track not found → null (never fall back to whatever sits at the cursor)
    return queue[index] && queue[index]!.track.id === trackId ? queue[index]! : null;
  }

  /** Insert at the current position (Spotify "play now" semantics) — atomic
   *  with the cursor so a concurrent advance cannot reorder the insert. */
  async insertAtCurrent(deviceId: string, track: Track, addedBy: string = "user"): Promise<QueueItem> {
    const item: QueueItem = { id: randomUUID(), track, addedBy };
    await this.mutateWithCursor(deviceId, (queue, index) => {
      const next = [...queue];
      next.splice(Math.min(index, next.length), 0, item);
      return { queue: next, index };
    });
    return item;
  }
}

export const queueService = new QueueService();
