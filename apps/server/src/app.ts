import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import rateLimit from "@fastify/rate-limit";
import websocket from "@fastify/websocket";
import { config } from "./config.js";
import { redis } from "./redis/client.js";
import { prisma } from "./db/prisma.js";
import { authRoutes, ensureSeedUser } from "./api/auth.js";
import { metricsText } from "./metrics.js";
import { deviceRoutes } from "./api/devices.js";
import { searchRoutes } from "./api/search.js";
import { queueRoutes } from "./api/queue.js";
import { playbackRoutes } from "./api/playback.js";
import { registerWsGateway } from "./ws/gateway.js";
import { libraryRoutes } from "./api/library.js";

/** Build the Fastify app (plugins, guards, routes). Exported for tests. */
export async function buildApp(): Promise<FastifyInstance> {
  // structured JSON logs (pino) — one line per request/event for PM2/observability
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" } });

  // Accept POST with an empty JSON body (e.g. pause/resume/next without payload)
  app.addContentTypeParser("application/json", { parseAs: "string" }, (_req, body, done) => {
    try {
      done(null, body === "" ? {} : JSON.parse(String(body)));
    } catch (err) {
      done(err as Error);
    }
  });

  // CORS: allowlist from env (comma-separated), permissive only in dev
  const corsOrigin = config.corsOrigin.length ? config.corsOrigin : true;
  await app.register(cors, { origin: corsOrigin });
  await app.register(jwt, { secret: config.jwtSecret });
  await app.register(rateLimit, { max: 300, timeWindow: "1 minute" }); // generous: web polls + volume debounce
  await app.register(websocket, { options: { maxPayload: 64 * 1024 } }); // 64 KB WS message cap

  // Health / readiness (PRD §41 D-12) — for Tianji / uptime monitoring
  app.get("/healthz", async () => ({ status: "ok", uptime: process.uptime() }));
  app.get("/health", async () => ({ status: "ok", uptime: process.uptime() }));
  app.get("/ready", async (_req, reply) => {
    try {
      await redis.ping();
      await prisma.$queryRaw`SELECT 1`;
      return { status: "ok", redis: "ok", mysql: "ok" };
    } catch (e) {
      return reply.code(503).send({ status: "degraded", error: (e as Error).message });
    }
  });

  // Prometheus-text metrics (scrape without auth, like /healthz)
  app.get("/metrics", async (_req, reply) => {
    reply.header("content-type", "text/plain; version=0.0.4; charset=utf-8");
    return metricsText();
  });

  // Security headers on every response (CSP omitted — Vue injects inline styles)
  app.addHook("onSend", async (_req, reply) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("X-Frame-Options", "DENY");
    reply.header("Referrer-Policy", "no-referrer");
    reply.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  });

  // Auth guard (PRD §30): all /api/* routes require a JWT except login and the
  // public player pairing flow. WebSocket has its own first-message auth (D-07).
  app.addHook("onRequest", async (req, reply) => {
    const url = req.url.split("?")[0] ?? "";
    if (url === "/api/auth/login" || url === "/api/player/pair" || url === "/healthz" || url === "/health" || url === "/ready" || url === "/metrics" || url.startsWith("/ws")) return;
    if (url.startsWith("/api/")) {
      try {
        await req.jwtVerify();
      } catch {
        return reply.code(401).send({ error: "UNAUTHORIZED" });
      }
    }
  });

  // Multi-user: every /api/devices/:id/* route (except pairing-code generation,
  // which may target a brand-new device) must operate on a device the caller owns.
  app.addHook("preHandler", async (req, reply) => {
    const url = req.url.split("?")[0] ?? "";
    const m = url.match(/^\/api\/devices\/([^/]+)(\/.*)?$/);
    if (!m) return;
    const id = decodeURIComponent(m[1] ?? "");
    if (m[2] === "/pair") return; // generate pairing code — device may not exist yet
    const user = req.user as { sub?: string } | undefined;
    if (!user?.sub) return reply.code(401).send({ error: "UNAUTHORIZED" });
    const device = await prisma.device.findUnique({ where: { id }, select: { userId: true } });
    if (!device) return reply.code(404).send({ error: "DEVICE_NOT_FOUND" });
    if (device.userId !== user.sub) return reply.code(403).send({ error: "DEVICE_FORBIDDEN" });
  });

  await app.register(authRoutes);
  await app.register(deviceRoutes);
  await app.register(searchRoutes);
  await app.register(queueRoutes);
  await app.register(playbackRoutes);
  await app.register(libraryRoutes);
  await registerWsGateway(app);

  return app;
}
