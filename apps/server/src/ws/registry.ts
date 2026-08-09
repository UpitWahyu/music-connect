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
const controllers = new Set<SocketLike>();

/** D-02: commands go over the player's WebSocket — no Redis pub/sub needed in V1. */
export function sendToPlayer(deviceId: string, msg: PlayerCommand): boolean {
  const s = players.get(deviceId);
  if (!s || s.readyState !== 1) return false;
  s.send(JSON.stringify(msg));
  return true;
}

export function registerPlayer(deviceId: string, socket: SocketLike): void {
  players.set(deviceId, socket);
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

export function addController(socket: SocketLike): void {
  controllers.add(socket);
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

export function broadcastToControllers(event: ServerEvent): void {
  const data = JSON.stringify(event);
  for (const c of controllers) if (c.readyState === 1) c.send(data);
}
