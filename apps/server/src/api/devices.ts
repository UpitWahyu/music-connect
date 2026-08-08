import type { FastifyInstance } from "fastify";
import { randomBytes } from "node:crypto";
import { RedisKeys } from "@music-connect/shared";
import { redis } from "../redis/client.js";
import { prisma } from "../db/prisma.js";
import { sha256 } from "../utils.js";

function generatePairingCode(): string {
  const part = (): string => String(randomBytes(2).readUInt16BE(0) % 1000).padStart(3, "0");
  return `${part()}-${part()}`;
}

/**
 * Device registry API (PRD §10, §28).
 * Player pairing: server issues a pairing code, the player agent submits it
 * once and receives a long-lived device token (D-03, D-10).
 */
export async function deviceRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/devices", async () => {
    const devices = await prisma.device.findMany();
    const online = new Set(await redis.smembers(RedisKeys.devicesOnline()));
    // never expose tokenHash to controllers
    return devices.map(({ tokenHash: _omit, ...d }) => ({ ...d, online: online.has(d.id) }));
  });

  /** Controller flow: generate a pairing code for a new player device. */
  app.post("/api/devices/:id/pair", async (req, reply) => {
    const { id } = req.params as { id: string };
    const code = generatePairingCode();
    // D-10: 5-minute TTL, one-time use
    await redis.set(RedisKeys.pairingCode(code), id, "EX", 300);
    await redis.set(RedisKeys.pairingDevice(id), code, "EX", 300);
    return { pairingCode: code, expiresIn: 300, deviceId: id };
  });

  /** Player flow: submit the pairing code, receive { deviceId, token }. */
  app.post("/api/player/pair", async (req, reply) => {
    const body = (req.body ?? {}) as { pairingCode?: string; name?: string; type?: string };
    if (!body.pairingCode) return reply.code(400).send({ error: "MISSING_PAIRING_CODE" });

    const code = body.pairingCode.trim();
    const deviceId = await redis.get(RedisKeys.pairingCode(code));
    if (!deviceId) return reply.code(404).send({ error: "INVALID_OR_EXPIRED_CODE" });

    // one-time: consume immediately (D-10)
    await redis.del(RedisKeys.pairingCode(code), RedisKeys.pairingDevice(deviceId));

    const token = randomBytes(32).toString("hex");
    const device = await prisma.device.upsert({
      where: { id: deviceId },
      update: { tokenHash: sha256(token), name: body.name ?? deviceId, type: body.type ?? "unknown" },
      create: { id: deviceId, name: body.name ?? deviceId, type: body.type ?? "unknown", tokenHash: sha256(token) },
    });
    return { deviceId: device.id, token };
  });

  app.delete("/api/devices/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    await prisma.device.delete({ where: { id } }).catch(() => null);
    await redis.srem(RedisKeys.devicesOnline(), id);
    return { ok: true };
  });
}
