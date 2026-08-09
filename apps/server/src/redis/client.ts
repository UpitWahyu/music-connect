import { Redis } from "ioredis";
import { config } from "../config.js";

export const redis = new Redis(config.redisUrl, {
  lazyConnect: true,
  maxRetriesPerRequest: 3,
  retryStrategy: (times) => Math.min(times * 500, 5000),
});

// never crash on transient Redis errors / late disconnect rejections
redis.on("error", () => {
  /* handled by retryStrategy + /ready health check */
});

export async function connectRedis(): Promise<void> {
  await redis.connect();
}
