import { randomUUID } from "node:crypto";
import type { QueueItem, Track } from "@music-connect/types";
import { RedisKeys } from "@music-connect/shared";
import { redis } from "../redis/client.js";
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
    const owner = await this.ownerOf(deviceId);
    const key = this.keyOf(owner);
    const lockKey = `${key}:lock`;
    const token = randomUUID();
    for (let attempt = 0; attempt < 50; attempt++) {
      const acquired = await redis.set(lockKey, token, "EX", 5, "NX");
      if (acquired) {
        try {
          const queue = await this.get(deviceId);
          const next = fn(queue);
          await redis.set(key, JSON.stringify(next));
          return next;
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
      // "Play next": insert right after the current track (cursor-aware),
      // not hardcoded at index 1
      const current = await this.getIndex(deviceId);
      return this.mutate(deviceId, (queue) => {
        queue.splice(Math.min(current + 1, queue.length), 0, item);
        return queue;
      });
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

  async clear(deviceId: string): Promise<QueueItem[]> {
    await this.setIndex(deviceId, 0);
    return this.mutate(deviceId, () => []);
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

  /** Advance to the next item. Returns null when the queue is exhausted. */
  async advance(deviceId: string): Promise<QueueItem | null> {
    const queue = await this.get(deviceId);
    const next = (await this.getIndex(deviceId)) + 1;
    if (next >= queue.length) return null;
    await this.setIndex(deviceId, next);
    return queue[next] ?? null;
  }

  /** Move the cursor to an existing track, or null if it's not in the queue. */
  async placeCurrent(deviceId: string, trackId: string): Promise<QueueItem | null> {
    const queue = await this.get(deviceId);
    const idx = queue.findIndex((i) => i.track.id === trackId);
    if (idx < 0) return null;
    await this.setIndex(deviceId, idx);
    return queue[idx] ?? null;
  }

  /** Insert at the current position (Spotify "play now" semantics). */
  async insertAtCurrent(deviceId: string, track: Track, addedBy: string = "user"): Promise<QueueItem> {
    const item: QueueItem = { id: randomUUID(), track, addedBy };
    const index = await this.getIndex(deviceId);
    await this.mutate(deviceId, (queue) => {
      queue.splice(Math.min(index, queue.length), 0, item);
      return queue;
    });
    return item;
  }
}

export const queueService = new QueueService();
