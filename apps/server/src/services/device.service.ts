import type { Device, DeviceType } from "@music-connect/types";
import { RedisKeys } from "@music-connect/shared";
import { prisma } from "../db/prisma.js";
import { redis } from "../redis/client.js";

/**
 * Device registry (PRD §9-§10).
 * Persistent record in MySQL, runtime presence in Redis.
 */
export class DeviceService {
  async list(): Promise<Device[]> {
    const devices = await prisma.device.findMany();
    const online = new Set(await redis.smembers(RedisKeys.devicesOnline()));
    return devices.map((d) => ({ ...d, type: d.type as DeviceType, online: online.has(d.id) }));
  }

  async markOnline(deviceId: string): Promise<void> {
    await redis.sadd(RedisKeys.devicesOnline(), deviceId);
    await redis.hset(RedisKeys.deviceMeta(deviceId), "lastSeen", Date.now());
  }

  async markOffline(deviceId: string): Promise<void> {
    await redis.srem(RedisKeys.devicesOnline(), deviceId);
  }

  async isOnline(deviceId: string): Promise<boolean> {
    return (await redis.sismember(RedisKeys.devicesOnline(), deviceId)) === 1;
  }

  /** D-11: volume is per-device and survives across sessions. */
  async setVolume(deviceId: string, volume: number): Promise<void> {
    await redis.hset(RedisKeys.deviceMeta(deviceId), "volume", volume);
    await prisma.device.update({ where: { id: deviceId }, data: { volume } }).catch(() => null);
  }
}

export const deviceService = new DeviceService();
