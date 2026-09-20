import { randomUUID, timingSafeEqual } from "node:crypto";
import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import rateLimit from "@fastify/rate-limit";
import websocket from "@fastify/websocket";
import cookie from "@fastify/cookie";
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
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? "info" },
    // Only trust the loopback reverse proxy (Caddy) so req.ip reflects the real
    // client for rate-limiting/logging without trusting arbitrary X-Forwarded-*.
    trustProxy: "127.0.0.1",
  });

  // 13: every response carries X-Request-Id so PM2 logs can be correlated
  app.addHook("onRequest", async (_req, reply) => {
    reply.header("x-request-id", randomUUID());
  });

  // Use Fastify's built-in (secure-json-parse backed) JSON parser so payloads
  // can't poison Object prototypes — but still accept an empty body for
  // bodyless commands (e.g. pause/resume/next without a payload).
  const defaultJsonParser = app.getDefaultJsonParser("error", "error");
  app.addContentTypeParser("application/json", { parseAs: "string" }, (req, body, done) => {
    if (body === "") return done(null, {});
    defaultJsonParser(req, String(body), done);
  });

  // CORS: allowlist from env (comma-separated), permissive only in dev
  const corsOrigin = config.corsOrigin.length ? config.corsOrigin : true;
  await app.register(cors, { origin: corsOrigin, credentials: true });
  await app.register(jwt, { secret: config.jwtSecret });
  await app.register(cookie);
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
      // Log the real cause server-side; never leak internal error details.
      console.error("[ready] dependency check failed:", e);
      return reply.code(503).send({ status: "degraded", redis: "error", mysql: "error" });
    }
  });

  // Prometheus-text metrics — protected behind a bearer token in production
  // (P1 #9). In dev it stays open for local scraping, matching /healthz.
  const metricsToken = process.env.METRICS_TOKEN;
  app.get("/metrics", async (req, reply) => {
    if (config.isProduction) {
      // Fail-closed: with no token configured the endpoint is hidden entirely.
      if (!metricsToken) return reply.code(404).send({ error: "NOT_FOUND" });
      const provided = Buffer.from(req.headers.authorization ?? "");
      const expected = Buffer.from(`Bearer ${metricsToken}`);
      // Constant-time compare to avoid leaking the token via response timing.
      if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
        return reply.code(401).send({ error: "UNAUTHORIZED" });
      }
    }
    reply.header("content-type", "text/plain; version=0.0.4; charset=utf-8");
    return metricsText();
  });

  // Security headers on every response (CSP omitted — Vue injects inline styles)
  app.addHook("onSend", async (_req, reply) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("X-Frame-Options", "DENY");
    reply.header("Referrer-Policy", "no-referrer");
    reply.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    // P2 #17: HSTS + COOP/CORP only when we are certain traffic is HTTPS
    // (Caddy terminates TLS, so the app always sees a secure origin behind it).
    if (process.env.NODE_ENV === "production") {
      reply.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
      reply.header("Cross-Origin-Opener-Policy", "same-origin");
      reply.header("Cross-Origin-Resource-Policy", "same-origin");
    }
  });

  // Auth guard (PRD §30): all /api/* routes require a JWT except login and the
  // public player pairing flow. WebSocket has its own first-message auth (D-07).
  app.addHook("onRequest", async (req, reply) => {
    const url = req.url.split("?")[0] ?? "";
    // Public / bootstrap routes that must NOT require a valid access token:
    // login, public player pairing, health, and the refresh/logout endpoints
    // (refresh is called exactly when the access token is expired or missing).
    if (
      url === "/api/auth/login" ||
      url === "/api/auth/refresh" ||
      url === "/api/auth/logout" ||
      url === "/api/player/pair" ||
      url === "/healthz" ||
      url === "/health" ||
      url === "/ready" ||
      url === "/metrics" ||
      url.startsWith("/ws")
    )
      return;
    if (url.startsWith("/api/")) {
      try {
        await req.jwtVerify();
      } catch {
        return reply.code(401).send({ error: "UNAUTHORIZED" });
      }
      // Reject refresh tokens (or any other JWT) presented as an access token.
      if ((req.user as { typ?: string }).typ !== "access") {
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
