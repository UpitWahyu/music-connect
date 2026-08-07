import { randomUUID } from "node:crypto";
import type { QueueItem, Track } from "@music-connect/types";
import { RedisKeys } from "@music-connect/shared";
import { redis } from "../redis/client.js";

/**
 * Server-controlled queue (PRD §24). Ephemeral — Redis only (PRD §41 D-05).
 * Items are identified by their stable item id, never by index (see §41).
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

  async remove(deviceId: string, itemId: string): Promise<QueueItem[]> {
    const queue = await this.get(deviceId);
    return this.set(deviceId, queue.filter((i) => i.id !== itemId));
  }

  async clear(deviceId: string): Promise<QueueItem[]> {
    return this.set(deviceId, []);
  }
}

export const queueService = new QueueService();
