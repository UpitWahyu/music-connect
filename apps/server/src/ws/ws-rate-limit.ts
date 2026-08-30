/**
 * Per-connection + per-user WebSocket command rate limiter (audit P0 #2).
 *
 * A single authenticated controller/player socket must not be able to flood
 * playback state, Redis, MySQL, mpv IPC, or broadcasts. We enforce:
 *
 *   - per-connection sliding window (default 20 cmd/s)
 *   - per-user sliding window     (default 100 cmd/s)
 *   - a hard cap on in-flight async commands (default 10)
 *
 * Coalesced commands (seek/volume) are exempt from the per-connection budget
 * because the web already debounces them and only the latest value matters.
 */
const WINDOW_MS = 1000;

export interface WsRateLimitConfig {
  perConnection: number;
  perUser: number;
  maxInFlight: number;
  /** command types that are coalesced — not rate-limited per connection */
  coalesced: Set<string>;
}

export const wsRateLimitConfig: WsRateLimitConfig = {
  perConnection: Number(process.env.WS_RATE_PER_CONN ?? 20),
  perUser: Number(process.env.WS_RATE_PER_USER ?? 100),
  maxInFlight: Number(process.env.WS_MAX_INFLIGHT ?? 10),
  coalesced: new Set(["player.state", "player.heartbeat", "player.setVolume", "player.seek"]),
};

interface Bucket {
  count: number;
  windowStart: number;
}

const connBuckets = new Map<unknown, Bucket>();
const userBuckets = new Map<string, Bucket>();
const inFlight = new Map<string, number>(); // keyed by user (or "anon:<conn>")

function slide(bucket: Bucket, now: number): void {
  if (now - bucket.windowStart >= WINDOW_MS) {
    bucket.count = 0;
    bucket.windowStart = now;
  }
}

/** Returns true if the command is allowed under the current limits. */
export function wsRateAllow(connKey: unknown, userKey: string, type: string): boolean {
  if (wsRateLimitConfig.coalesced.has(type)) return true;
  const now = Date.now();
  let cb = connBuckets.get(connKey);
  if (!cb) {
    cb = { count: 0, windowStart: now };
    connBuckets.set(connKey, cb);
  }
  slide(cb, now);
  if (cb.count >= wsRateLimitConfig.perConnection) return false;
  cb.count++;

  let ub = userBuckets.get(userKey);
  if (!ub) {
    ub = { count: 0, windowStart: now };
    userBuckets.set(userKey, ub);
  }
  slide(ub, now);
  if (ub.count >= wsRateLimitConfig.perUser) return false;
  ub.count++;
  return true;
}

/** Track in-flight async commands (server-side playback ops). */
export function wsInFlightInc(key: string): boolean {
  const cur = inFlight.get(key) ?? 0;
  if (cur >= wsRateLimitConfig.maxInFlight) return false;
  inFlight.set(key, cur + 1);
  return true;
}

export function wsInFlightDec(key: string): void {
  const cur = inFlight.get(key) ?? 0;
  if (cur > 0) inFlight.set(key, cur - 1);
}
