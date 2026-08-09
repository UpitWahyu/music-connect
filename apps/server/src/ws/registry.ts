import type { PlayerCommand, ServerEvent } from "@music-connect/protocol";

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
}

export function unregisterPlayer(deviceId: string): void {
  players.delete(deviceId);
}

/** Live presence — source of truth for the device list (Redis set can go stale). */
export function isPlayerRegistered(deviceId: string): boolean {
  const s = players.get(deviceId);
  return !!s && s.readyState === 1;
}

export function addController(socket: SocketLike): void {
  controllers.add(socket);
}

export function removeController(socket: SocketLike): void {
  controllers.delete(socket);
}

export function broadcastToControllers(event: ServerEvent): void {
  const data = JSON.stringify(event);
  for (const c of controllers) if (c.readyState === 1) c.send(data);
}
