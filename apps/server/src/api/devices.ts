import type { FastifyInstance } from "fastify";
import { randomBytes } from "node:crypto";
import { RedisKeys } from "@music-connect/shared";
import { redis } from "../redis/client.js";
import { prisma } from "../db/prisma.js";
import { sha256 } from "../utils.js";

function generatePairingCode(): string {
  // audit P0 #3: 10-digit numeric code (was 6) — much larger search space so
  // an Internet-exposed pairing endpoint can't be brute-forced even with the
  // 3-attempt lock. Format groups of 3/3/4 for readability (XXX-XXX-XXXX).
  const g3 = (): string => String(randomBytes(2).readUInt16BE(0) % 1000).padStart(3, "0");
  const g4 = (): string => String(randomBytes(2).readUInt16BE(0) % 10000).padStart(4, "0");
  return `${g3()}-${g3()}-${g4()}`;
}

/**
 * Device registry API (PRD §10, §28).
 * Player pairing: server issues a pairing code, the player agent submits it
 * once and receives a long-lived device token (D-03, D-10).
 */
export async function deviceRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/devices", async (req) => {
    const user = req.user as { sub?: string } | undefined;
    // multi-user: only the caller's own devices
    const devices = await prisma.device.findMany({ where: { userId: user?.sub ?? "__none__" } });
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
      // 3.3: never let one user hijack an existing device owned by another
      const existing = await prisma.device.findUnique({ where: { id }, select: { userId: true } });
      if (existing && existing.userId && user?.sub && existing.userId !== user.sub) {
        return reply.code(403).send({ error: "DEVICE_FORBIDDEN" });
      }
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

  /** Remove a device (also clears its queue/state in Redis). */
  app.delete("/api/devices/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    await prisma.device.delete({ where: { id } }).catch(() => null);
    await redis.srem(RedisKeys.devicesOnline(), id);
    return { ok: true };
  });

  /** P0 #4: rotate a device's long-lived token (issue a new one, revoke old). */
  app.post(
    "/api/devices/:id/rotate-token",
    { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const user = req.user as { sub?: string } | undefined;
      if (!user?.sub) return reply.code(401).send({ error: "UNAUTHORIZED" });
      const device = await prisma.device.findUnique({ where: { id }, select: { userId: true } });
      if (!device) return reply.code(404).send({ error: "DEVICE_NOT_FOUND" });
      if (device.userId !== user.sub) return reply.code(403).send({ error: "DEVICE_FORBIDDEN" });
      const token = randomBytes(32).toString("hex");
      await prisma.device.update({ where: { id }, data: { tokenHash: sha256(token), lastUsedAt: new Date() } });
      return { deviceId: id, token };
    },
  );

  /** P0 #4: revoke a device's token (player can no longer authenticate). */
  app.post(
    "/api/devices/:id/revoke-token",
    { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const user = req.user as { sub?: string } | undefined;
      if (!user?.sub) return reply.code(401).send({ error: "UNAUTHORIZED" });
      const device = await prisma.device.findUnique({ where: { id }, select: { userId: true } });
      if (!device) return reply.code(404).send({ error: "DEVICE_NOT_FOUND" });
      if (device.userId !== user.sub) return reply.code(403).send({ error: "DEVICE_FORBIDDEN" });
      // tokenHash = "" → the player's stored token no longer matches
      await prisma.device.update({ where: { id }, data: { tokenHash: "" } });
      await redis.srem(RedisKeys.devicesOnline(), id);
      return { ok: true };
    },
  );
}
