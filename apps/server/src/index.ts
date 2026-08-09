import Fastify from "fastify";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import rateLimit from "@fastify/rate-limit";
import websocket from "@fastify/websocket";
import { config } from "./config.js";
import { connectRedis } from "./redis/client.js";
import { authRoutes, ensureSeedUser } from "./api/auth.js";
import { deviceRoutes } from "./api/devices.js";
import { searchRoutes } from "./api/search.js";
import { queueRoutes } from "./api/queue.js";
import { playbackRoutes } from "./api/playback.js";
import { registerWsGateway } from "./ws/gateway.js";
import { libraryRoutes } from "./api/library.js";

const app = Fastify({ logger: true });

// Accept POST with an empty JSON body (e.g. pause/resume/next without payload)
app.addContentTypeParser("application/json", { parseAs: "string" }, (_req, body, done) => {
  try {
    done(null, body === "" ? {} : JSON.parse(String(body)));
  } catch (err) {
    done(err as Error);
  }
});

await app.register(cors, { origin: true });
await app.register(jwt, { secret: config.jwtSecret });
await app.register(rateLimit, { max: 300, timeWindow: "1 minute" }); // generous: web polls + volume debounce
await app.register(websocket);

// Health endpoint (PRD §41 D-12) — for Tianji / uptime monitoring
app.get("/healthz", async () => ({ status: "ok", uptime: process.uptime() }));

// Auth guard (PRD §30): all /api/* routes require a JWT except login and the
// public player pairing flow. WebSocket has its own first-message auth (D-07).
app.addHook("onRequest", async (req, reply) => {
  const url = req.url.split("?")[0] ?? "";
  if (url === "/api/auth/login" || url === "/api/player/pair" || url === "/healthz" || url.startsWith("/ws")) return;
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

await connectRedis();
await ensureSeedUser(); // DB-backed credentials: env only seeds the first user
await app.listen({ port: config.port, host: config.host });
