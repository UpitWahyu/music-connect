import { beforeAll, afterAll, describe, it, expect } from "vitest";
import "dotenv/config";
import { redis, connectRedis } from "../redis/client.js";
import { prisma } from "../db/prisma.js";
import { buildApp } from "../app.js";
import { hashPassword } from "../api/auth.js";
import type { FastifyInstance } from "fastify";

let app: FastifyInstance;
let token: string;
const USER = "test-auth-user";

beforeAll(async () => {
  await connectRedis();
  await prisma.user.upsert({
    where: { id: USER },
    update: { passwordHash: hashPassword("authpass123") },
    create: { id: USER, username: "authtest", passwordHash: hashPassword("authpass123"), role: "admin" },
  });
  app = await buildApp();
  // login ONCE — the login route is rate-limited (5/min)
  const login = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { username: "authtest", password: "authpass123" },
  });
  expect(login.statusCode).toBe(200);
  token = JSON.parse(login.body).token as string;
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: USER } }).catch(() => null);
  await app.close();
  await redis.quit();
  await prisma.$disconnect();
});

describe("auth", () => {
  it("login with valid credentials returns a token", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "authtest", password: "authpass123" },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).token).toBeTruthy();
  });

  it("login with a wrong password is rejected", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "authtest", password: "nope" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("login with an unknown user is rejected", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "ghost", password: "x" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("missing credentials are a 400", async () => {
    const res = await app.inject({ method: "POST", url: "/api/auth/login", payload: {} });
    expect(res.statusCode).toBe(400);
  });

  it("protected routes reject requests without a token", async () => {
    const res = await app.inject({ method: "GET", url: "/api/devices" });
    expect(res.statusCode).toBe(401);
  });

  it("protected routes accept a valid token", async () => {
    const res = await app.inject({ method: "GET", url: "/api/devices", headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(200);
  });

  it("change password: wrong old password → 401", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/auth/password",
      headers: { authorization: `Bearer ${token}` },
      payload: { oldPassword: "wrong", newPassword: "newpass123" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("change password: correct old password → 200, new password works, restore", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/auth/password",
      headers: { authorization: `Bearer ${token}` },
      payload: { oldPassword: "authpass123", newPassword: "newpass123" },
    });
    expect(res.statusCode).toBe(200);
    const relogin = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "authtest", password: "newpass123" },
    });
    expect(relogin.statusCode).toBe(200);
    const newToken = JSON.parse(relogin.body).token as string;
    // restore the original password for other tests / reruns
    const restore = await app.inject({
      method: "PUT",
      url: "/api/auth/password",
      headers: { authorization: `Bearer ${newToken}` },
      payload: { oldPassword: "newpass123", newPassword: "authpass123" },
    });
    expect(restore.statusCode).toBe(200);
  });
});
