import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// Load the ROOT .env explicitly — PM2 runs with cwd=apps/server, where the
// plain dotenv/config lookup would silently miss it and fall back to the
// hardcoded dev secret (a real security hole once the repo is public).
loadEnv({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env") });

export interface ServerConfig {
  port: number;
  host: string;
  jwtSecret: string;
  redisUrl: string;
  pairingCodeTtlSeconds: number;
  deviceTokenTtlDays: number;
  corsOrigin: string[];
}

export const config: ServerConfig = {
  port: Number(process.env.PORT ?? 3000),
  host: process.env.HOST ?? "0.0.0.0",
  // D-10: production must set a strong secret
  jwtSecret: process.env.JWT_SECRET ?? "dev-secret-change-me",
  redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379",
  pairingCodeTtlSeconds: Number(process.env.PAIRING_CODE_TTL ?? 300), // D-10: 5 min TTL
  deviceTokenTtlDays: Number(process.env.DEVICE_TOKEN_TTL_DAYS ?? 365),
  // Comma-separated CORS allowlist (empty = permissive, dev only)
  corsOrigin: (process.env.CORS_ORIGIN ?? "").split(",").map((h) => h.trim()).filter(Boolean),
};
