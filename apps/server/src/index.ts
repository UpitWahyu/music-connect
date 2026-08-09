import { buildApp } from "./app.js";
import { config } from "./config.js";
import { redis, connectRedis } from "./redis/client.js";
import { prisma } from "./db/prisma.js";
import { ensureSeedUser } from "./api/auth.js";

const app = await buildApp();

// Production env validation — fail fast instead of running half-configured
if (process.env.NODE_ENV === "production") {
  const required = ["JWT_SECRET", "DATABASE_URL", "REDIS_URL"];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    throw new Error(`[config] missing required env in production: ${missing.join(", ")}`);
  }
  if ((process.env.JWT_SECRET ?? "").length < 16) {
    throw new Error("[config] JWT_SECRET must be at least 16 chars in production");
  }
}

await connectRedis();
await ensureSeedUser(); // DB-backed credentials: env only seeds the first user
await app.listen({ port: config.port, host: config.host });

// Graceful shutdown (PM2 / Docker / systemd)
async function shutdown(signal: string): Promise<void> {
  app.log.info({ signal }, "shutting down gracefully");
  try {
    await app.close(); // stop accepting requests/WS, drain in-flight
  } catch (e) {
    app.log.error({ err: e }, "error during close");
  }
  try {
    await redis.quit();
  } catch {
    /* already closed */
  }
  await prisma.$disconnect().catch(() => null);
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
