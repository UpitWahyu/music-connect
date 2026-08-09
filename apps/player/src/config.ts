import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export interface PlayerConfig {
  serverUrl: string;
  deviceId: string;
  deviceName: string;
  deviceType: string;
  pairingCode?: string;
  mpvIpc: string;
  heartbeatMs: number;
  stateReportMs: number;
}

const credentialsPath = path.join(homedir(), ".config", "music-player", "credentials.json");

export function loadConfig(): PlayerConfig {
  return {
    serverUrl: process.env.MUSIC_SERVER_URL ?? "ws://localhost:3000",
    deviceId: process.env.DEVICE_ID ?? "desktop",
    deviceName: process.env.DEVICE_NAME ?? "Desktop",
    deviceType: process.env.DEVICE_TYPE ?? "desktop",
    pairingCode: process.env.PAIRING_CODE,
    // D-04: IPC endpoint — TCP loopback by default (reliable on Termux/Android
    // and Windows), unix socket path via MPV_IPC when explicitly set
    mpvIpc: process.env.MPV_IPC ?? "127.0.0.1:32001",
    heartbeatMs: Number(process.env.HEARTBEAT_MS ?? 5000), // D-06
    stateReportMs: Number(process.env.STATE_REPORT_MS ?? 2000), // D-06
  };
}

export function loadCredentials(): { deviceId: string; token: string } | null {
  if (!existsSync(credentialsPath)) return null;
  try {
    return JSON.parse(readFileSync(credentialsPath, "utf8")) as { deviceId: string; token: string };
  } catch {
    return null;
  }
}

export function saveCredentials(deviceId: string, token: string): void {
  mkdirSync(path.dirname(credentialsPath), { recursive: true });
  writeFileSync(credentialsPath, JSON.stringify({ deviceId, token }, null, 2), { mode: 0o600 });
}
