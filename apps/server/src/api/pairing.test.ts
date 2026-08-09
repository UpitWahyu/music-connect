import { beforeAll, afterAll, describe, it, expect } from "vitest";
import "dotenv/config";
import { redis, connectRedis } from "../redis/client.js";
import { prisma } from "../db/prisma.js";
import { buildApp } from "../app.js";
import { hashPassword } from "./auth.js";
import type { FastifyInstance } from "fastify";

let app: FastifyInstance;
const USER = "test-pair-user";
const DEVICE = "test-device-pair";

beforeAll(async () => {
  await connectRedis();
  await prisma.user.upsert({
    where: { id: USER },
    update: { passwordHash: hashPassword("pairpass123") },
    create: { id: USER, username: "pairtest", passwordHash: hashPassword("pairpass123"), role: "admin" },
  });
  await prisma.device.upsert({
    where: { id: DEVICE },
    update: { userId: null, name: "QA Pair" },
    create: { id: DEVICE, name: "QA Pair", type: "qa", tokenHash: "x" },
  });
  app = await buildApp();
});

afterAll(async () => {
  await prisma.device.deleteMany({ where: { id: DEVICE } }).catch(() => null);
  await prisma.user.deleteMany({ where: { id: USER } }).catch(() => null);
  await app.close();
  await redis.quit();
  await prisma.$disconnect();
});

async function loginToken(): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { username: "pairtest", password: "pairpass123" },
  });
  return JSON.parse(res.body).token as string;
}

describe("pairing", () => {
  it("generates a one-time code valid for 5 minutes", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/devices/${DEVICE}/pair`,
      headers: { authorization: `Bearer ${await loginToken()}` },
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.pairingCode).toMatch(/^\d{3}-\d{3}$/);
    expect(body.expiresIn).toBe(300);
    const ttl = await redis.ttl(`music:pairing:${body.pairingCode}`);
    expect(ttl).toBeGreaterThan(290);
    await redis.del(`music:pairing:${body.pairingCode}`, `music:pairing:device:${DEVICE}`);
  });

  it("consumes a valid code exactly once (reuse → 404)", async () => {
    const gen = await app.inject({
      method: "POST",
      url: `/api/devices/${DEVICE}/pair`,
      headers: { authorization: `Bearer ${await loginToken()}` },
      payload: {},
    });
    const code = JSON.parse(gen.body).pairingCode;
    const first = await app.inject({
      method: "POST",
      url: "/api/player/pair",
      payload: { pairingCode: code, name: "QA Player", type: "qa" },
    });
    expect(first.statusCode).toBe(200);
    expect(JSON.parse(first.body).token).toBeTruthy();
    const second = await app.inject({
      method: "POST",
      url: "/api/player/pair",
      payload: { pairingCode: code, name: "QA Player 2", type: "qa" },
    });
    expect(second.statusCode).toBe(404);
  });

  it("3 wrong attempts lock the code (PAIRING_LOCKED)", async () => {
    const gen = await app.inject({
      method: "POST",
      url: `/api/devices/${DEVICE}/pair`,
      headers: { authorization: `Bearer ${await loginToken()}` },
      payload: {},
    });
    const code = JSON.parse(gen.body).pairingCode;
    // same wrong code 3 times → attempts accumulate → locked on the 3rd
    let locked = false;
    for (let i = 1; i <= 3; i++) {
      const res = await app.inject({
        method: "POST",
        url: "/api/player/pair",
        payload: { pairingCode: "100-000" },
      });
      if (res.statusCode === 423) locked = true;
    }
    expect(locked).toBe(true);
    // attempts on a wrong code must NOT touch other codes — the real one
    // stays usable (per-code counter, not a global lock)
    const after = await app.inject({
      method: "POST",
      url: "/api/player/pair",
      payload: { pairingCode: code },
    });
    expect(after.statusCode).toBe(200);
    await redis.del(`music:pairing:attempts:100-000`);
  });

  it("rejects a missing pairing code", async () => {
    const res = await app.inject({ method: "POST", url: "/api/player/pair", payload: {} });
    expect(res.statusCode).toBe(400);
  });
});
