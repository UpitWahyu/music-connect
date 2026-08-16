/**
 * Runtime validation for every WebSocket message (5.1).
 * TypeScript types are compile-time only — network input is untrusted, so
 * both the server gateway and the player agent validate with Zod before use.
 */
import { z } from "zod";

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
  z.object({ type: z.literal("player.trackEnded"), deviceId: z.string().min(1) }),
  z.object({ type: z.literal("player.error"), code: z.string().min(1), message: z.string() }),
]);

/** Server → Player commands (validated on the player side). */
export const serverCommandSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("player.load"),
    trackId: z.string().min(1),
    media: z.union([
      z.object({ mode: z.literal("id"), youtubeId: z.string().min(1) }),
      z.object({ mode: z.literal("url"), url: z.string().min(1) }),
    ]),
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
    media: z.union([
      z.object({ mode: z.literal("id"), youtubeId: z.string().min(1) }),
      z.object({ mode: z.literal("url"), url: z.string().min(1) }),
    ]),
  }),
  z.object({ type: z.literal("player.prefetchClear") }),
]);
