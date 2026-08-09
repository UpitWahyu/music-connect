import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import rateLimit from "@fastify/rate-limit";
import websocket from "@fastify/websocket";
import { config } from "./config.js";
import { redis } from "./redis/client.js";
import { prisma } from "./db/prisma.js";
import { authRoutes, ensureSeedUser } from "./api/auth.js";
import { deviceRoutes } from "./api/devices.js";
import { searchRoutes } from "./api/search.js";
import { queueRoutes } from "./api/queue.js";
import { playbackRoutes } from "./api/playback.js";
import { registerWsGateway } from "./ws/gateway.js";
import { libraryRoutes } from "./api/library.js";

/** Build the Fastify app (plugins, guards, routes). Exported for tests. */
export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

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

  // Auth guard (PRD §30): all /api/* routes require a JWT except login and the
  // public player pairing flow. WebSocket has its own first-message auth (D-07).
  app.addHook("onRequest", async (req, reply) => {
    const url = req.url.split("?")[0] ?? "";
    if (url === "/api/auth/login" || url === "/api/player/pair" || url === "/healthz" || url === "/health" || url === "/ready" || url.startsWith("/ws")) return;
    if (url.startsWith("/api/")) {
      try {
        await req.jwtVerify();
      } catch {
        return reply.code(401).send({ error: "UNAUTHORIZED" });
      }
    }
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
