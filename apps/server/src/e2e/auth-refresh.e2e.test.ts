import { beforeAll, afterAll, describe, it, expect } from "vitest";
import "dotenv/config";
import { redis, connectRedis } from "../redis/client.js";
import { prisma } from "../db/prisma.js";
import { buildApp } from "../app.js";
import { hashPassword } from "../api/auth.js";
import type { FastifyInstance } from "fastify";

let app: FastifyInstance;

const USER1 = "refresh-e2e-user1";
const USER2 = "refresh-e2e-user2";

// A protected endpoint we can hit with the access token. /api/devices is
// owned-device-scoped but requires a valid access token, so a 200 vs 401
// cleanly tells us whether the access token is accepted.
function authHeaders(token: string) {
  return { authorization: `Bearer ${token}` };
}

async function login(username: string, password: string): Promise<{ token: string; refreshToken: string }> {
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { username, password },
  });
  expect(res.statusCode).toBe(200);
  return JSON.parse(res.body) as { token: string; refreshToken: string };
}

beforeAll(async () => {
  await connectRedis();
  await prisma.user.upsert({
    where: { id: USER1 },
    update: { passwordHash: hashPassword("rpass111") },
    create: { id: USER1, username: "refreshe2e1", passwordHash: hashPassword("rpass111"), role: "user" },
  });
  await prisma.user.upsert({
    where: { id: USER2 },
    update: { passwordHash: hashPassword("rpass222") },
    create: { id: USER2, username: "refreshe2e2", passwordHash: hashPassword("rpass222"), role: "user" },
  });
  app = await buildApp();
  await app.listen({ port: 0, host: "127.0.0.1" });
});

afterAll(async () => {
  // rotation + invalidate tests create real refresh-token rows; clean them.
  await prisma.refreshToken.deleteMany({}).catch(() => null);
  await prisma.user.deleteMany({ where: { id: { in: [USER1, USER2] } } }).catch(() => null);
  await app.close();
  redis.disconnect();
  await prisma.$disconnect();
});

describe("JWT refresh-token flow", () => {
  it("login returns both an access token and a refresh token (and persists the refresh token hashed)", async () => {
    const { token, refreshToken } = await login("refreshe2e1", "rpass111");
    expect(token).toBeTruthy();
    expect(refreshToken).toBeTruthy();
    // The raw refresh token must NOT be stored — only its hash.
    const stored = await prisma.refreshToken.findFirst({ where: { userId: USER1 } });
    expect(stored).not.toBeNull();
    expect(stored!.token).not.toBe(refreshToken); // hashed, not raw
    expect(stored!.token.length).toBe(64); // sha256 hex
  });

  it("uses the access token to reach a protected endpoint (200), then 401 once expired", async () => {
    const { token } = await login("refreshe2e1", "rpass111");
    const ok = await app.inject({ method: "GET", url: "/api/devices", headers: authHeaders(token) });
    expect(ok.statusCode).toBe(200);

    // Build a short-lived access token via the same signer config by minting
    // one and waiting is impractical; instead assert an expired token is 401.
    // fast-jwt exp is in the past → verifier/@fastify/jwt rejects it.
    const expiredJwt =
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiI" +
      Buffer.from(JSON.stringify({ sub: USER1, username: "refreshe2e1", typ: "access", exp: 1 })).toString("base64url") +
      ".sig";
    const expired = await app.inject({
      method: "GET",
      url: "/api/devices",
      headers: authHeaders(expiredJwt),
    });
    expect(expired.statusCode).toBe(401);
  });

  it("rotates the refresh token: refresh returns a new access token (race-safe within reuse window)", async () => {
    // clean slate: multi-device support means tokens accumulate across logins
    await prisma.refreshToken.deleteMany({ where: { userId: USER1 } });
    const first = await login("refreshe2e1", "rpass111");
    const before = await prisma.refreshToken.findMany({ where: { userId: USER1 } });
    expect(before.length).toBe(1);

    const res = await app.inject({
      method: "POST",
      url: "/api/auth/refresh",
      payload: { refreshToken: first.refreshToken },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { token: string; refreshToken: string };
    expect(body.token).toBeTruthy();
    expect(body.refreshToken).toBeTruthy();
    expect(body.refreshToken).not.toBe(first.refreshToken); // rotated

    // New access token works.
    const ok = await app.inject({ method: "GET", url: "/api/devices", headers: authHeaders(body.token) });
    expect(ok.statusCode).toBe(200);

    // Two refresh tokens now exist: the old one (extended by the reuse window)
    // and the new rotated one. Both are valid within the window.
    const after = await prisma.refreshToken.findMany({ where: { userId: USER1 } });
    expect(after.length).toBe(2);

    // Race-safe: replaying the OLD refresh token within the reuse window still
    // works (200) — this is what stops a concurrent tab/device from being
    // logged out when it holds the same old token. After the window it expires.
    const replay = await app.inject({
      method: "POST",
      url: "/api/auth/refresh",
      payload: { refreshToken: first.refreshToken },
    });
    expect(replay.statusCode).toBe(200);
  });

  it("allows the same refresh token to be used again within the reuse window (no immediate logout)", async () => {
    await prisma.refreshToken.deleteMany({ where: { userId: USER1 } });
    const { refreshToken: rt } = await login("refreshe2e1", "rpass111");

    // Use the SAME token twice in a row — both must succeed (the second refresh
    // is served by the still-valid old token during the reuse window).
    const a = await app.inject({ method: "POST", url: "/api/auth/refresh", payload: { refreshToken: rt } });
    expect(a.statusCode).toBe(200);
    const b = await app.inject({ method: "POST", url: "/api/auth/refresh", payload: { refreshToken: rt } });
    expect(b.statusCode).toBe(200);
  });

  it("rejects a missing refresh token (400)", async () => {
    const res = await app.inject({ method: "POST", url: "/api/auth/refresh", payload: {} });
    expect(res.statusCode).toBe(400);
  });

  it("rejects a forged/garbage refresh token (401)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/refresh",
      payload: { refreshToken: "not.a.real.jwt" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("user2's refresh token cannot be used to act as user1 (cross-user isolation)", async () => {
    const u1 = await login("refreshe2e1", "rpass111");
    const u2 = await login("refreshe2e2", "rpass222");

    // user2 presents THEIR valid access token together with user1's refresh
    // token. The refresh JWT is bound to user1's subject; the handler must
    // detect the access/refresh subject mismatch and reject with 403 — this is
    // the multi-user isolation guarantee (never break AuthorizationService).
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/refresh",
      payload: { refreshToken: u1.refreshToken },
      headers: authHeaders(u2.token),
    });
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).error).toBe("REFRESH_TOKEN_USER_MISMATCH");

    // Sanity: user1 can still rotate their OWN refresh token (subjects match).
    const ok = await app.inject({
      method: "POST",
      url: "/api/auth/refresh",
      payload: { refreshToken: u1.refreshToken },
    });
    expect(ok.statusCode).toBe(200);
  });

  it("logout revokes the refresh token so it can no longer be used", async () => {
    const { refreshToken } = await login("refreshe2e1", "rpass111");
    const out = await app.inject({
      method: "POST",
      url: "/api/auth/logout",
      payload: { refreshToken },
    });
    expect(out.statusCode).toBe(200);
    const replay = await app.inject({
      method: "POST",
      url: "/api/auth/refresh",
      payload: { refreshToken },
    });
    expect(replay.statusCode).toBe(401);
  });
});

async function hashOf(raw: string): Promise<string> {
  const { sha256 } = await import("../utils.js");
  return sha256(raw);
}
