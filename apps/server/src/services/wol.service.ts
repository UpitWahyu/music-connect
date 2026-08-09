import { RouterOSAPI } from "node-routeros";

/**
 * Remote wake-up (Phase 9, PRD §35): sends a Wake-on-LAN magic packet to a
 * player device through MikroTik (`/tool/wol`). The music server usually
 * lives in a datacenter, so it can't broadcast UDP on the user's LAN — the
 * router does it for us. Config via env (never committed):
 *   MIKROTIK_HOST / MIKROTIK_PORT / MIKROTIK_USER / MIKROTIK_PASSWORD
 *   MIKROTIK_WOL_INTERFACE (default Bridge-Hotspot)
 */
interface MikrotikConfig {
  host?: string;
  port: number;
  user?: string;
  password?: string;
  wolInterface: string;
}

function mikrotikConfig(): MikrotikConfig {
  return {
    host: process.env.MIKROTIK_HOST,
    port: Number(process.env.MIKROTIK_PORT ?? 8728),
    user: process.env.MIKROTIK_USER,
    password: process.env.MIKROTIK_PASSWORD,
    wolInterface: process.env.MIKROTIK_WOL_INTERFACE ?? "Bridge-Hotspot",
  };
}

const MAC_RE = /^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/;

export class WolService {
  /** Send the magic packet. Throws MIKROTIK_NOT_CONFIGURED / INVALID_MAC_ADDRESS / MIKROTIK_TRAP. */
  async wake(macAddress: string): Promise<void> {
    const cfg = mikrotikConfig();
    if (!cfg.host || !cfg.user || !cfg.password) throw new Error("MIKROTIK_NOT_CONFIGURED");
    if (!MAC_RE.test(macAddress)) throw new Error("INVALID_MAC_ADDRESS");

    const conn = new RouterOSAPI({ host: cfg.host, user: cfg.user, password: cfg.password, port: cfg.port, timeout: 5 });
    try {
      await conn.connect();
      const res = await conn.write(["/tool/wol", `=mac=${macAddress}`, `=interface=${cfg.wolInterface}`]);
      if (res.some((r) => "trap" in r && r.trap)) throw new Error("MIKROTIK_TRAP");
    } finally {
      conn.close();
    }
  }

  /** Read-only connectivity check (router identity). Safe — never sends WOL. */
  async ping(): Promise<string | null> {
    const cfg = mikrotikConfig();
    if (!cfg.host || !cfg.user || !cfg.password) return null;
    const conn = new RouterOSAPI({ host: cfg.host, user: cfg.user, password: cfg.password, port: cfg.port, timeout: 5 });
    try {
      await conn.connect();
      const res = await conn.write(["/system/identity/print"]);
      const name = res[0]?.name;
      return typeof name === "string" && name.length > 0 ? name : "connected";
    } catch {
      return null;
    } finally {
      conn.close();
    }
  }
}

export const wolService = new WolService();
