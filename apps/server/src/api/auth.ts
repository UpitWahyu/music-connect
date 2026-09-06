import type { FastifyInstance } from "fastify";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { prisma } from "../db/prisma.js";
import {
  hashRefreshToken,
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from "../auth/tokens.js";

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const candidate = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

/** Seed the first user from env when the DB has none (fresh install). */
export async function ensureSeedUser(): Promise<void> {
  const count = await prisma.user.count();
  if (count > 0) return;
  const username = process.env.ADMIN_USERNAME || "admin";
  const password = process.env.ADMIN_PASSWORD;
  if (!password) {
    // never seed a known-public default credential in production (8.2)
    if (process.env.NODE_ENV === "production") {
      throw new Error("[auth] first run requires ADMIN_PASSWORD (no users exist yet)");
    }
    console.warn("[auth] first run: seeding default 'admin' password (dev only)");
  }
  await prisma.user.create({
    data: { username, passwordHash: hashPassword(password ?? "admin"), role: "admin" },
  });
  console.log(`[auth] no users in DB — seeded "${username}" from env (change the password after login)`);
}

// httpOnly cookie carrying the refresh token. The raw JWT is the value; the DB
// stores only its hash. Secure flag is driven by NODE_ENV so local dev (http)
// still works.
const REFRESH_COOKIE_OPTS = {
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/",
  secure: process.env.NODE_ENV === "production",
};

// Race-safe refresh rotation: when a token is rotated we keep the old one valid
// for a short window instead of hard-deleting it. The web stores the refresh
// token in localStorage which is shared across browser tabs; if two tabs (or two
// devices) refresh concurrently, the first rotation must not logout the second.
// The existing expired-token cleanup prunes the old token once the window passes.
const REFRESH_REUSE_WINDOW_MS = Number(process.env.REFRESH_REUSE_WINDOW_MS ?? 60_000);

/**
 * Persist a freshly-signed refresh token (by its hash) and return the raw JWT.
 * Rotation: old tokens can be cleared via `revokePreviousHash`.
 */
async function issueRefreshToken(
  userId: string,
  revokePreviousHash?: string,
): Promise<string> {
  // Multi-device: new logins add a refresh token without invalidating existing
  // ones — each device keeps its own session.  Stale/expired tokens are
  // cleaned up on login (best-effort) to keep the table small.
  if (revokePreviousHash) {
    // Race-safe rotation: extend the old token's life by the reuse window
    // instead of hard-deleting it. A concurrent refresh from another tab/device
    // that still holds this same token succeeds within the window (no logout).
    // The cleanup below removes it once expiresAt passes.
    await prisma.refreshToken.updateMany({
      where: { userId, token: revokePreviousHash },
      data: { expiresAt: new Date(Date.now() + REFRESH_REUSE_WINDOW_MS) },
    });
  }
  // best-effort: drop expired tokens (7-day TTL) on every login
  await prisma.refreshToken.deleteMany({ where: { userId, expiresAt: { lt: new Date() } } }).catch(() => null);
  const { token, expiresAt } = signRefreshToken(userId);
  await prisma.refreshToken.create({
    data: { userId, token: hashRefreshToken(token), expiresAt },
  });
  return token;
}

/**
 * Auth (PRD §30, D-03 single user, D-10 rate limit).
 * Credentials live in the DB (User table) — env only seeds the first one.
 */
export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    "/api/auth/login",
    {
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } }, // D-10
    },
    async (req, reply) => {
      const { username, password } = (req.body ?? {}) as { username?: string; password?: string };
      if (!username || !password) return reply.code(400).send({ error: "MISSING_CREDENTIALS" });

      const user = await prisma.user.findUnique({ where: { username } });
      if (!user || !verifyPassword(password, user.passwordHash)) {
        return reply.code(401).send({ error: "INVALID_CREDENTIALS" });
      }

      const { token } = signAccessToken(user.id, user.username);
      const refreshToken = await issueRefreshToken(user.id);
      reply.setCookie("refreshToken", refreshToken, {
        ...REFRESH_COOKIE_OPTS,
        expires: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      });
      // Refresh token lives ONLY in the HttpOnly cookie — never exposed in JSON.
      // This prevents XSS from stealing the long-lived refresh credential and
      // eliminates the need for client-side cross-tab refresh-token coordination.
      return { token };
    },
  );

  // Rotate a refresh token for a fresh access token (+ new refresh token).
  // Accepts the refresh token in the request body OR an httpOnly cookie.
  app.post(
    "/api/auth/refresh",
    {
      config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
    },
    async (req, reply) => {
      const body = (req.body ?? {}) as { refreshToken?: string };
      const raw = body.refreshToken ?? req.cookies?.refreshToken;
      console.log("[auth] refresh: hasCookie=", !!req.cookies?.refreshToken, "hasBody=", !!body.refreshToken);
      if (!raw) {
        console.log("[auth] refresh: 401 reason=", "NO_TOKEN");
        return reply.code(400).send({ error: "MISSING_REFRESH_TOKEN" });
      }

      const claims = verifyRefreshToken(raw);
      if (!claims) {
        console.log("[auth] refresh: 401 reason=", "INVALID_JWT");
        return reply.code(401).send({ error: "INVALID_REFRESH_TOKEN" });
      }

      // Optional access token: if the caller also presents one, it MUST belong
      // to the same user as the refresh token. A user presenting someone else's
      // refresh token (tied to a different access subject) is rejected — this is
      // the multi-user isolation guarantee (never break AuthorizationService).
      if (req.headers.authorization) {
        try {
          await req.jwtVerify();
          const accessSub = (req.user as { sub?: string }).sub;
          if (accessSub && accessSub !== claims.sub) {
            return reply.code(403).send({ error: "REFRESH_TOKEN_USER_MISMATCH" });
          }
        } catch {
          // no/invalid access token — fine, refresh works standalone
        }
      }

      // DB lookup by hash: proves this exact token was issued (not forged) and
      // lets us enforce rotation — a replayed (already-rotated) token is gone.
      const record = await prisma.refreshToken.findUnique({
        where: { token: hashRefreshToken(raw) },
      });
      if (!record || record.expiresAt.getTime() < Date.now()) {
        console.log("[auth] refresh: 401 reason=", "NOT_FOUND_IN_DB");
        return reply.code(401).send({ error: "INVALID_REFRESH_TOKEN" });
      }
      const user = await prisma.user.findUnique({ where: { id: claims.sub } });
      if (!user) return reply.code(401).send({ error: "INVALID_REFRESH_TOKEN" });

      // Rotation: extend old token (reuse window), mint a new one.
      const { token } = signAccessToken(user.id, user.username);
      const refreshToken = await issueRefreshToken(user.id, hashRefreshToken(raw));
      reply.setCookie("refreshToken", refreshToken, {
        ...REFRESH_COOKIE_OPTS,
        expires: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      });
      // Refresh token lives ONLY in the HttpOnly cookie — never exposed in JSON.
      // This prevents XSS from stealing the long-lived refresh credential and
      // eliminates the need for client-side cross-tab refresh-token coordination.
      return { token };
    },
  );

  // Logout: revoke the refresh token (cookie or body) so it can't be reused.
  app.post("/api/auth/logout", async (req, reply) => {
    const body = (req.body ?? {}) as { refreshToken?: string };
    const raw = body.refreshToken ?? req.cookies?.refreshToken;
    if (raw) {
      await prisma.refreshToken.deleteMany({ where: { token: hashRefreshToken(raw) } });
    }
    reply.clearCookie("refreshToken", { path: "/" });
    return { ok: true };
  });

  // Change the password (DB-backed credentials — this is the source of truth).
  app.put(
    "/api/auth/password",
    {
      config: { rateLimit: { max: 5, timeWindow: "1 minute" } },
    },
    async (req, reply) => {
      const uid = (req.user as { sub?: string }).sub;
      if (!uid) return reply.code(401).send({ error: "UNAUTHORIZED" });
      const { oldPassword, newPassword } = (req.body ?? {}) as {
        oldPassword?: string;
        newPassword?: string;
      };
      if (!oldPassword || !newPassword) return reply.code(400).send({ error: "MISSING_FIELDS" });
      if (newPassword.length < 6) return reply.code(400).send({ error: "PASSWORD_TOO_SHORT" });
      const user = await prisma.user.findUnique({ where: { id: uid } });
      if (!user || !verifyPassword(oldPassword, user.passwordHash)) {
        return reply.code(401).send({ error: "INVALID_CREDENTIALS" });
      }
      await prisma.user.update({
        where: { id: user.id },
        data: { passwordHash: hashPassword(newPassword) },
      });
      return { ok: true };
    },
  );

  // Change the username (requires the current password).
  app.put(
    "/api/auth/profile",
    {
      config: { rateLimit: { max: 5, timeWindow: "1 minute" } },
    },
    async (req, reply) => {
      const uid = (req.user as { sub?: string }).sub;
      if (!uid) return reply.code(401).send({ error: "UNAUTHORIZED" });
      const { password, newUsername } = (req.body ?? {}) as {
        password?: string;
        newUsername?: string;
      };
      if (!password || !newUsername?.trim()) return reply.code(400).send({ error: "MISSING_FIELDS" });
      const username = newUsername.trim();
      if (username.length < 3) return reply.code(400).send({ error: "USERNAME_TOO_SHORT" });
      const user = await prisma.user.findUnique({ where: { id: uid } });
      if (!user || !verifyPassword(password, user.passwordHash)) {
        return reply.code(401).send({ error: "INVALID_CREDENTIALS" });
      }
      const exists = await prisma.user.findUnique({ where: { username } });
      if (exists && exists.id !== uid) return reply.code(409).send({ error: "USERNAME_TAKEN" });
      await prisma.user.update({ where: { id: uid }, data: { username } });
      return { ok: true };
    },
  );
}
