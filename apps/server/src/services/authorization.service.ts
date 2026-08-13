import { prisma } from "../db/prisma.js";

/**
 * Centralized device authorization (multi-user isolation).
 * Used by REST preHandler, WebSocket commands and handoff — one source of
 * truth for "can this user touch this device?".
 */
export class AuthorizationService {
  /** Throws DEVICE_NOT_FOUND / DEVICE_FORBIDDEN. */
  async assertDeviceAccess(userId: string, deviceId: string): Promise<void> {
    const device = await prisma.device.findUnique({ where: { id: deviceId }, select: { userId: true } });
    if (!device) throw new Error("DEVICE_NOT_FOUND");
    if (device.userId !== userId) throw new Error("DEVICE_FORBIDDEN");
  }

  /** All ids must belong to the user (e.g. handoff from → to). */
  async assertDevicesAccess(userId: string, deviceIds: string[]): Promise<void> {
    if (deviceIds.length === 0) return;
    const devices = await prisma.device.findMany({
      where: { id: { in: deviceIds } },
      select: { id: true, userId: true },
    });
    const owned = new Set(devices.filter((d) => d.userId === userId).map((d) => d.id));
    for (const id of deviceIds) {
      if (!owned.has(id)) throw new Error("DEVICE_FORBIDDEN");
    }
  }

  async canControlDevice(userId: string, deviceId: string): Promise<boolean> {
    try {
      await this.assertDeviceAccess(userId, deviceId);
      return true;
    } catch {
      return false;
    }
  }
}

export const authorizationService = new AuthorizationService();
