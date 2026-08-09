import type { FastifyInstance } from "fastify";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { prisma } from "../db/prisma.js";

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
  const password = process.env.ADMIN_PASSWORD || "admin";
  await prisma.user.create({
    data: { username, passwordHash: hashPassword(password), role: "admin" },
  });
  console.log(`[auth] no users in DB — seeded "${username}" from env (change the password after login)`);
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

      const token = app.jwt.sign({ sub: user.id, username: user.username });
      return { token };
    },
  );

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
