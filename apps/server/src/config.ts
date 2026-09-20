import { config as loadEnv } from "dotenv";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// Load the ROOT .env explicitly — PM2 runs with cwd=apps/server, where the
// plain dotenv/config lookup would silently miss it and fall back to the
// hardcoded dev secret (a real security hole once the repo is public).
loadEnv({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env") });

// Fail-closed: only an explicit development/test environment is treated as
// non-production. Anything else (including an unset NODE_ENV) is production,
// so a misconfigured deployment can never silently run with dev defaults.
const IS_DEV = ["development", "test"].includes(process.env.NODE_ENV ?? "");
const IS_PRODUCTION = !IS_DEV;

/** A fresh, unguessable secret for local dev when env is unset. */
function randomSecret(): string {
  return randomBytes(32).toString("hex");
}

/** Fail-fast in production: secrets must be set & strong; dev uses a random one. */
function requiredSecret(name: string): string {
  const value = process.env[name] ?? "";
  if (IS_PRODUCTION) {
    if (value.length < 32) {
      throw new Error(`${name} wajib diisi (min 32 karakter) saat NODE_ENV=production`);
    }
    return value;
  }
  // Never fall back to a hardcoded, public secret — generate one per process.
  return value || randomSecret();
}

export interface ServerConfig {
  port: number;
  host: string;
  jwtSecret: string;
  refreshSecret: string;
  redisUrl: string;
  pairingCodeTtlSeconds: number;
  deviceTokenTtlDays: number;
  corsOrigin: string[];
  /** Fail-closed production flag (true unless NODE_ENV is development/test). */
  isProduction: boolean;
}

let corsOrigin = (process.env.CORS_ORIGIN ?? "")
  .split(",")
  .map((h) => h.trim())
  .filter(Boolean);
if (IS_PRODUCTION && corsOrigin.length === 0) {
  throw new Error("CORS_ORIGIN wajib diisi (allowlist) saat NODE_ENV=production");
}

export const config: ServerConfig = {
  port: Number(process.env.PORT ?? 3000),
  host: process.env.HOST ?? "0.0.0.0",
  // D-10: production must set a strong secret
  jwtSecret: requiredSecret("JWT_SECRET"),
  // Refresh tokens are signed with their own secret. In production it must be
  // set explicitly so a leak of the access secret can't forge refresh tokens.
  // In dev it falls back to a random per-process secret — never to JWT_SECRET.
  refreshSecret: requiredSecret("REFRESH_SECRET"),
  redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379",
  pairingCodeTtlSeconds: Number(process.env.PAIRING_CODE_TTL ?? 300), // D-10: 5 min TTL
  deviceTokenTtlDays: Number(process.env.DEVICE_TOKEN_TTL_DAYS ?? 365),
  // Comma-separated CORS allowlist (empty = permissive, dev only)
  corsOrigin,
  isProduction: IS_PRODUCTION,
};
