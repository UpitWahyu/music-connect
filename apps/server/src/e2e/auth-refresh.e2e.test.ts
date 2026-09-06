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

function authHeaders(token: string) {
  return { authorization: `Bearer ${token}` };
}

/**
 * Login and extract the refresh token from the Set-Cookie header.
 * The server now returns only { token } in JSON — the refresh token lives
 * in an HttpOnly cookie, so we pull it from the raw response headers.
 */
async function login(username: string, password: string): Promise<{ token: string; refreshToken: string }> {
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { username, password },
  });
  expect(res.statusCode).toBe(200);
  const body = JSON.parse(res.body) as { token: string };
  // Extract refreshToken from Set-Cookie header (e.g. "refreshToken=xxx; Path=/; HttpOnly; ...")
  const setCookie = res.headers["set-cookie"] as string | string[] | undefined;
  const cookies = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  let rt = "";
  for (const c of cookies) {
    const m = c.match(/^refreshToken=([^;]+)/);
    if (m) { rt = m[1]; break; }
  }
  expect(rt).toBeTruthy(); // cookie must be set
  return { token: body.token, refreshToken: rt };
}

/** Inject a refresh request with the token in the cookie header. */
async function refreshWithCookie(rt: string, extra?: { headers?: Record<string, string> }) {
  return app.inject({
    method: "POST",
    url: "/api/auth/refresh",
    payload: {},
    ...extra,
    headers: { ...extra?.headers, cookie: `refreshToken=${rt}` },
  });
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
  await prisma.refreshToken.deleteMany({}).catch(() => null);
  await prisma.user.deleteMany({ where: { id: { in: [USER1, USER2] } } }).catch(() => null);
  await app.close();
  redis.disconnect();
  await prisma.$disconnect();
});

describe("JWT refresh-token flow", () => {
  it("login returns an access token and sets an HttpOnly refresh-token cookie", async () => {
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

    const expiredJwt =
      "eyJhbG...iOiI" +
      Buffer.from(JSON.stringify({ sub: USER1, username: "refreshe2e1", typ: "access", exp: 1 })).toString("base64url") +
      ".sig";
    const expired = await app.inject({ method: "GET", url: "/api/devices", headers: authHeaders(expiredJwt) });
    expect(expired.statusCode).toBe(401);
  });

  it("rotates the refresh token: refresh returns a new access token (race-safe within reuse window)", async () => {
    await prisma.refreshToken.deleteMany({ where: { userId: USER1 } });
    const first = await login("refreshe2e1", "rpass111");
    const before = await prisma.refreshToken.findMany({ where: { userId: USER1 } });
    expect(before.length).toBe(1);

    // Refresh via cookie
    const res = await refreshWithCookie(first.refreshToken);
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { token: string };
    expect(body.token).toBeTruthy();
    // No refreshToken in JSON anymore (cookie-only)
    expect((body as Record<string, unknown>).refreshToken).toBeUndefined();

    // New access token works.
    const ok = await app.inject({ method: "GET", url: "/api/devices", headers: authHeaders(body.token) });
    expect(ok.statusCode).toBe(200);

    // Two refresh tokens now exist: old (extended) + new (rotated).
    const after = await prisma.refreshToken.findMany({ where: { userId: USER1 } });
    expect(after.length).toBe(2);

    // Race-safe: replaying the OLD refresh token within the reuse window still works.
    const replay = await refreshWithCookie(first.refreshToken);
    expect(replay.statusCode).toBe(200);
  });

  it("allows the same refresh token to be used again within the reuse window", async () => {
    await prisma.refreshToken.deleteMany({ where: { userId: USER1 } });
    const { refreshToken: rt } = await login("refreshe2e1", "rpass111");

    const a = await refreshWithCookie(rt);
    expect(a.statusCode).toBe(200);
    const b = await refreshWithCookie(rt);
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
      payload: {},
      headers: { cookie: "refreshToken=not.a.real.jwt" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("user2's refresh token cannot be used to act as user1 (cross-user isolation)", async () => {
    const u1 = await login("refreshe2e1", "rpass111");
    const u2 = await login("refreshe2e2", "rpass222");

    // user2 presents THEIR valid access token together with user1's refresh
    // cookie. The refresh JWT is bound to user1's subject; the handler must
    // detect the access/refresh subject mismatch and reject with 403.
    const res = await refreshWithCookie(u1.refreshToken, { headers: authHeaders(u2.token) });
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).error).toBe("REFRESH_TOKEN_USER_MISMATCH");

    // Sanity: user1 can still rotate their OWN refresh token (subjects match).
    const ok = await refreshWithCookie(u1.refreshToken);
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
    const replay = await refreshWithCookie(refreshToken);
    expect(replay.statusCode).toBe(401);
  });
});
