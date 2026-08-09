import { randomUUID } from "node:crypto";
import type { QueueItem, Track } from "@music-connect/types";
import { RedisKeys } from "@music-connect/shared";
import { redis } from "../redis/client.js";

/**
 * Server-controlled queue (PRD §24). Ephemeral — Redis only (PRD §41 D-05).
 * Items are identified by their stable item id, never by index (see §41).
 * The current position (queueIndex) is server-authoritative (D-08).
 */
export class QueueService {
  async get(deviceId: string): Promise<QueueItem[]> {
    const raw = await redis.get(RedisKeys.deviceQueue(deviceId));
    return raw ? (JSON.parse(raw) as QueueItem[]) : [];
  }

  async set(deviceId: string, items: QueueItem[]): Promise<QueueItem[]> {
    await redis.set(RedisKeys.deviceQueue(deviceId), JSON.stringify(items));
    return items;
  }

  async add(deviceId: string, track: Track, position?: "next"): Promise<QueueItem[]> {
    const queue = await this.get(deviceId);
    const item: QueueItem = { id: randomUUID(), track, addedBy: "user" };
    if (position === "next") queue.splice(1, 0, item); // play next
    else queue.push(item);
    return this.set(deviceId, queue);
  }

  /** Auto-queued recommendations are marked addedBy: "auto". */
  async addAuto(deviceId: string, track: Track): Promise<QueueItem[]> {
    const queue = await this.get(deviceId);
    const item: QueueItem = { id: randomUUID(), track, addedBy: "auto" };
    queue.push(item);
    return this.set(deviceId, queue);
  }

  async remove(deviceId: string, itemId: string): Promise<QueueItem[]> {
    const queue = await this.get(deviceId);
    return this.set(deviceId, queue.filter((i) => i.id !== itemId));
  }

  async clear(deviceId: string): Promise<QueueItem[]> {
    await this.setIndex(deviceId, 0);
    return this.set(deviceId, []);
  }

  /** Player-reported authoritative duration (D-08) — fixes 0:00 tracks. */
  async updateTrackDuration(deviceId: string, trackId: string, duration: number): Promise<void> {
    const queue = await this.get(deviceId);
    const item = queue.find((i) => i.track.id === trackId);
    if (item && item.track.duration !== duration) {
      item.track.duration = duration;
      await this.set(deviceId, queue);
    }
  }

  // --- current position (server-authoritative, D-08) ---

  async getIndex(deviceId: string): Promise<number> {
    const raw = await redis.get(RedisKeys.deviceQueueIndex(deviceId));
    return raw ? Number(raw) : 0;
  }

  async setIndex(deviceId: string, index: number): Promise<void> {
    await redis.set(RedisKeys.deviceQueueIndex(deviceId), String(index));
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
    const queue = await this.get(deviceId);
    const index = await this.getIndex(deviceId);
    const item: QueueItem = { id: randomUUID(), track, addedBy };
    queue.splice(index, 0, item);
    await this.set(deviceId, queue);
    return item;
  }
}

export const queueService = new QueueService();
