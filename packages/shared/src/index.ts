/**
 * Shared utilities: Redis key layout (PRD §19, §24 — unified) and
 * position interpolation (PRD §17).
 */
import type { PlaybackState } from "@music-connect/types";

/**
 * Redis key layout. `music:queue:{deviceId}` from PRD §24 was unified with
 * the `music:device:{deviceId}:*` namespace from §19 (see §41).
 */
export const RedisKeys = {
  deviceState: (deviceId: string): string => `music:device:${deviceId}:state`,
  deviceQueue: (deviceId: string): string => `music:device:${deviceId}:queue`,
  deviceMeta: (deviceId: string): string => `music:device:${deviceId}:meta`,
  devicesOnline: (): string => "music:devices:online",
  pairingCode: (code: string): string => `music:pairing:${code}`,
  pairingDevice: (deviceId: string): string => `music:pairing:device:${deviceId}`,
  cacheSearch: (query: string): string => `music:cache:search:${query.toLowerCase()}`,
  cacheMetadata: (provider: string, id: string): string => `music:cache:meta:${provider}:${id}`,
} as const;

/**
 * Controller-side position calculation (PRD §17).
 * While playing, extrapolate from the last authoritative report.
 */
export function interpolatePosition(
  state: Pick<PlaybackState, "state" | "position" | "updatedAt">,
  now: number = Date.now(),
): number {
  return state.state === "playing" ? state.position + (now - state.updatedAt) / 1000 : state.position;
}

export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}
