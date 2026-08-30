/**
 * Runtime validation for every WebSocket message (5.1).
 * TypeScript types are compile-time only — network input is untrusted, so
 * both the server gateway and the player agent validate with Zod before use.
 */
import { z } from "zod";

// Audit P0 #5: validate Track request bodies at runtime (TypeScript types
// vanish at runtime; an attacker could send arbitrary JSON). Bounds mirror
// the PRD §14 normalized shape. The `id` is a provider id (YouTube video id).
export const trackSchema = z.object({
  id: z.string().min(1).max(64),
  provider: z.string().min(1).max(64),
  title: z.string().min(1).max(500),
  artist: z.string().min(0).max(500),
  album: z.string().max(500).optional(),
  duration: z.number().finite().min(0).max(86400), // <= 24h
  thumbnail: z.string().url().max(2048).optional().or(z.literal("")).optional(),
});

export const queueAddSchema = z.object({
  track: trackSchema,
  playNext: z.boolean().optional(),
});

export const reorderSchema = z.object({
  order: z.array(z.string().min(1).max(64)).min(1).max(500),
});

// --- controller → server ---

export const controllerAuthSchema = z.object({
  type: z.literal("auth"),
  token: z.string().min(1),
});

const commandBase = z.object({ deviceId: z.string().min(1) });

export const controllerCommandSchema = z.discriminatedUnion("type", [
  commandBase.extend({ type: z.literal("setVolume"), volume: z.number().finite().min(0).max(100) }),
  commandBase.extend({ type: z.literal("pause") }),
  commandBase.extend({ type: z.literal("resume") }),
  commandBase.extend({ type: z.literal("next") }),
  commandBase.extend({ type: z.literal("previous") }),
  commandBase.extend({ type: z.literal("seek"), position: z.number().finite().min(0) }),
  commandBase.extend({ type: z.literal("shuffle"), shuffle: z.boolean() }),
  commandBase.extend({ type: z.literal("repeat"), mode: z.enum(["off", "all", "one"]) }),
]);

// --- player ↔ server ---

export const playerAuthSchema = z.object({
  type: z.literal("player.auth"),
  deviceId: z.string().min(1),
  token: z.string().min(1),
});

export const playerStateReportSchema = z.object({
  deviceId: z.string().min(1),
  status: z.enum(["playing", "paused", "stopped", "offline"]),
  trackId: z.string().nullable(),
  position: z.number().finite().min(0),
  duration: z.number().finite().min(0).optional(),
  volume: z.number().finite().min(0).max(100),
  queueIndex: z.number().finite().min(0),
  updatedAt: z.number().finite(),
});

export const playerEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("player.heartbeat"), deviceId: z.string().min(1), position: z.number().finite(), status: z.enum(["playing", "paused", "stopped", "offline"]) }),
  z.object({ type: z.literal("player.state"), report: playerStateReportSchema }),
  z.object({
    type: z.literal("player.trackEnded"),
    deviceId: z.string().min(1),
    // "error" = stream failed (retry on the server); absent/eof = natural end
    reason: z.enum(["eof", "error"]).optional(),
  }),
  z.object({ type: z.literal("player.error"), code: z.string().min(1), message: z.string() }),
]);

/** Server → Player commands (validated on the player side). */
/** Audit P0 #6: restrict arbitrary media URLs sent to the player.
 *  Only https is allowed, with a bounded length and an explicit host allowlist
 *  of trusted stream hosts (YouTube/YT-Music/Google CDN). A player runs inside
 *  the user's local network — an arbitrary URL could be used for SSRF into
 *  internal services the public server itself can't reach. */
const ALLOWED_URL_HOSTS = new Set([
  "googlevideo.com",
  "youtube.com",
  "youtu.be",
  "music.youtube.com",
  "ytimg.com",
  "ggpht.com",
  "i.ytimg.com",
]);

export function safeMediaUrl(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== "https:") return false;
  if (u.hostname.length > 255) return false;
  // match exact host or a *.host suffix (e.g. r1---sn-xxx.googlevideo.com)
  const host = u.hostname.toLowerCase();
  for (const allowed of ALLOWED_URL_HOSTS) {
    if (host === allowed || host.endsWith(`.${allowed}`)) return true;
  }
  return false;
}

const mediaSchema = z.union([
  z.object({ mode: z.literal("id"), youtubeId: z.string().min(1).max(32) }),
  z
    .object({ mode: z.literal("url"), url: z.string().min(1).max(2048) })
    .refine((v) => safeMediaUrl(v.url), { message: "URL host not allowlisted (https YouTube/Google CDN only)" }),
]);

export const serverCommandSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("player.load"),
    trackId: z.string().min(1),
    media: mediaSchema,
    position: z.number().finite().min(0).optional(),
    volume: z.number().finite().min(0).max(100).optional(),
  }),
  z.object({ type: z.literal("player.play") }),
  z.object({ type: z.literal("player.pause") }),
  z.object({ type: z.literal("player.resume") }),
  z.object({ type: z.literal("player.seek"), position: z.number().finite().min(0) }),
  z.object({ type: z.literal("player.setVolume"), volume: z.number().finite().min(0).max(100) }),
  z.object({ type: z.literal("player.stop") }),
  z.object({
    type: z.literal("player.prefetch"),
    trackId: z.string().min(1),
    media: mediaSchema,
  }),
  z.object({ type: z.literal("player.prefetchClear") }),
]);
