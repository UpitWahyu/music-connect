import type { PlayerCommand, ServerEvent } from "@music-connect/protocol";
import { setGauge } from "../metrics.js";

/**
 * Live connection registry. Structural socket type keeps this package free
 * of a direct ws dependency.
 */
export interface SocketLike {
  readyState: number; // 1 = OPEN
  send(data: string): void;
  close(code?: number, reason?: string): void;
  on(event: string, listener: (...args: unknown[]) => void): void;
}

const players = new Map<string, SocketLike>();
// controller socket → owning user id (from the JWT); null = legacy/unbound
const controllers = new Map<SocketLike, string | null>();
// deviceId → owning user id (learned at player auth); used to scope broadcasts
const deviceOwner = new Map<string, string | null>();

/** D-02: commands go over the player's WebSocket — no Redis pub/sub needed in V1. */
export function sendToPlayer(deviceId: string, msg: PlayerCommand): boolean {
  const s = players.get(deviceId);
  if (!s || s.readyState !== 1) return false;
  s.send(JSON.stringify(msg));
  return true;
}

export function registerPlayer(deviceId: string, socket: SocketLike, ownerId: string | null = null): void {
  players.set(deviceId, socket);
  deviceOwner.set(deviceId, ownerId);
  setGauge("music_active_players", players.size);
}

/**
 * Remove a player connection — but ONLY if the socket still owns the entry.
 * Prevents a stale (old) connection from deleting a newer registration during
 * a reconnect race.
 */
export function unregisterPlayer(deviceId: string, socket: SocketLike): void {
  if (players.get(deviceId) === socket) {
    players.delete(deviceId);
    setGauge("music_active_players", players.size);
  }
}

/** Live presence — source of truth for the device list (Redis set can go stale). */
export function isPlayerRegistered(deviceId: string): boolean {
  const s = players.get(deviceId);
  return !!s && s.readyState === 1;
}

export function addController(socket: SocketLike, userId: string | null = null): void {
  controllers.set(socket, userId);
  setGauge("music_active_controllers", controllers.size);
}

export function removeController(socket: SocketLike): void {
  controllers.delete(socket);
  setGauge("music_active_controllers", controllers.size);
}

/** Live player count (metrics + debugging). */
export function activePlayerCount(): number {
  return players.size;
}

/**
 * P0 (device.selected): deliver an event ONLY to the controllers of one user
 * — never broadcast user-scoped selections/events to other accounts.
 */
export function sendToUser(userId: string, event: ServerEvent): void {
  const data = JSON.stringify(event);
  for (const [c, u] of controllers) {
    if (c.readyState !== 1) continue;
    if (u === userId) c.send(data);
  }
}

/** Devices the user is allowed to see (their own + unbound legacy ones). */
export function deviceIdsForUser(userId: string): string[] {
  const ids: string[] = [];
  for (const [id, owner] of deviceOwner) {
    if (owner === null || owner === undefined || owner === userId) ids.push(id);
  }
  return ids;
}

/**
 * Multi-user: deliver an event ONLY to controllers who own the device it
 * refers to. Legacy devices without an owner broadcast to everyone (the
 * pre-multi-user behaviour), keeping single-user setups unchanged.
 */
export function broadcastToControllers(event: ServerEvent): void {
  const data = JSON.stringify(event);
  const deviceId = "deviceId" in event && typeof event.deviceId === "string" ? event.deviceId : null;
  const owner = deviceId ? deviceOwner.get(deviceId) : null;
  for (const [c, userId] of controllers) {
    if (c.readyState !== 1) continue;
    // unbound device → broadcast; bound device → only the owner's controllers
    if (owner === null || owner === undefined || userId === owner) c.send(data);
  }
}
