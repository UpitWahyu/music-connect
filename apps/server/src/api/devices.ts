import type { FastifyInstance } from "fastify";
import { randomBytes } from "node:crypto";
import { RedisKeys } from "@music-connect/shared";
import { redis } from "../redis/client.js";
import { prisma } from "../db/prisma.js";
import { sha256 } from "../utils.js";
import { wolService } from "../services/wol.service.js";

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
  app.post(
    "/api/devices/:id/pair",
    { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const code = generatePairingCode();
      const user = req.user as { sub?: string } | undefined;
      // D-10: 5-minute TTL, one-time use; remember who owns the device
      await redis.set(RedisKeys.pairingCode(code), id, "EX", 300);
      await redis.set(RedisKeys.pairingDevice(id), code, "EX", 300);
      if (user?.sub) await redis.set(RedisKeys.pairingUser(code), user.sub, "EX", 300);
      return { pairingCode: code, expiresIn: 300, deviceId: id };
    },
  );

  /** Player flow: submit the pairing code, receive { deviceId, token }. */
  app.post(
    "/api/player/pair",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const body = (req.body ?? {}) as { pairingCode?: string; name?: string; type?: string };
      if (!body.pairingCode) return reply.code(400).send({ error: "MISSING_PAIRING_CODE" });

      const code = body.pairingCode.trim();
      // Atomic consume (GETDEL): a code can only be used by ONE concurrent
      // request — the loser sees null and lands in the attempt counter.
      const deviceId = await redis.getdel(RedisKeys.pairingCode(code));
      if (!deviceId) {
        // invalid / expired / already consumed
        const attempts = await redis.incr(RedisKeys.pairingAttempts(code));
        await redis.expire(RedisKeys.pairingAttempts(code), 300);
        if (attempts >= 3) {
          // brute-force protection: invalidate whatever is left of the code
          await redis.del(RedisKeys.pairingCode(code), RedisKeys.pairingDevice(code));
          return reply.code(423).send({ error: "PAIRING_LOCKED" });
        }
        return reply.code(404).send({ error: "INVALID_OR_EXPIRED_CODE" });
      }

      const ownerId = await redis.get(RedisKeys.pairingUser(code));
      await redis.del(RedisKeys.pairingDevice(deviceId));
      if (ownerId) await redis.del(RedisKeys.pairingUser(code));
      await redis.del(RedisKeys.pairingAttempts(code));

      const token = randomBytes(32).toString("hex");
      const device = await prisma.device.upsert({
        where: { id: deviceId },
        update: { tokenHash: sha256(token), name: body.name ?? deviceId, type: body.type ?? "unknown", userId: ownerId ?? undefined },
        create: { id: deviceId, name: body.name ?? deviceId, type: body.type ?? "unknown", tokenHash: sha256(token), userId: ownerId ?? undefined },
      });
      return { deviceId: device.id, token };
    },
  );

  /** Set device metadata (e.g. MAC address for WOL wake-up, Phase 9). */
  app.put("/api/devices/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as { macAddress?: string };
    if (body.macAddress !== undefined && !/^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/.test(body.macAddress)) {
      return reply.code(400).send({ error: "INVALID_MAC_ADDRESS" });
    }
    const device = await prisma.device
      .update({ where: { id }, data: { macAddress: body.macAddress ? body.macAddress.toUpperCase() : null } })
      .catch(() => null);
    if (!device) return reply.code(404).send({ error: "DEVICE_NOT_FOUND" });
    return { ok: true, device };
  });

  /** Remote wake-up: send WOL magic packet via MikroTik (Phase 9). */
  app.post("/api/devices/:id/wake", async (req, reply) => {
    const { id } = req.params as { id: string };
    const device = await prisma.device.findUnique({ where: { id } });
    if (!device) return reply.code(404).send({ error: "DEVICE_NOT_FOUND" });
    try {
      await wolService.wake(device.macAddress ?? "");
      return { ok: true };
    } catch (e) {
      const msg = (e as Error).message;
      if (msg === "MIKROTIK_NOT_CONFIGURED" || msg === "INVALID_MAC_ADDRESS") {
        return reply.code(400).send({ error: msg });
      }
      return reply.code(502).send({ error: msg });
    }
  });

  app.delete("/api/devices/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    await prisma.device.delete({ where: { id } }).catch(() => null);
    await redis.srem(RedisKeys.devicesOnline(), id);
    return { ok: true };
  });
}
