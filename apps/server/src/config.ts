import "dotenv/config";

export interface ServerConfig {
  port: number;
  host: string;
  jwtSecret: string;
  redisUrl: string;
  pairingCodeTtlSeconds: number;
  deviceTokenTtlDays: number;
}

export const config: ServerConfig = {
  port: Number(process.env.PORT ?? 3000),
  host: process.env.HOST ?? "0.0.0.0",
  // D-10: production must set a strong secret
  jwtSecret: process.env.JWT_SECRET ?? "dev-secret-change-me",
  redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379",
  pairingCodeTtlSeconds: Number(process.env.PAIRING_CODE_TTL ?? 300), // D-10: 5 min TTL
  deviceTokenTtlDays: Number(process.env.DEVICE_TOKEN_TTL_DAYS ?? 365),
};
