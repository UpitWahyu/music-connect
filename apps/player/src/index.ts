import { loadConfig, loadCredentials, saveCredentials, type PlayerConfig } from "./config.js";
import { PlayerConnection } from "./connection.js";
import { Mpv } from "./mpv.js";
import { PlayerState } from "./state.js";
import { makeCommandHandler } from "./commands.js";

const config = loadConfig();
const state = new PlayerState();
const mpv = new Mpv(config.mpvSocket);
mpv.start();

// The player agent is a long-running process — a failed mpv/IPC interaction
// must never take it down. Log and keep going.
process.on("unhandledRejection", (reason) => {
  console.error("[player] unhandled rejection:", reason);
});
process.on("uncaughtException", (err) => {
  console.error("[player] uncaught exception:", err instanceof Error ? err.message : err);
});

// Pairing (PRD §10): on first run the user supplies PAIRING_CODE from the web
// UI. The returned device token is stored in ~/.config/music-player/.
let credentials = loadCredentials();
if (!credentials) {
  const code = config.pairingCode;
  if (!code) {
    console.error("[player] No credentials found. Pair this device first:");
    console.error("[player]   PAIRING_CODE=<code-from-web-ui> pnpm dev");
    process.exit(1);
  }
  credentials = await pair(config, code);
}

const conn = new PlayerConnection(config.serverUrl, credentials.deviceId, credentials.token);
const handleCommand = makeCommandHandler(mpv, state);

conn.on("ready", () => {
  console.log(`[player] registered as "${credentials.deviceId}"`);
  // D-08: after (re)connect, report current state so the server can re-sync
  conn.send({ type: "player.state", report: state.toReport(credentials.deviceId) });
});
conn.on("command", (cmd) => {
  void handleCommand(cmd).catch((e) => {
    // a failed mpv command must never kill the player agent
    console.error("[player] command failed:", cmd.type, e instanceof Error ? e.message : e);
  });
});
conn.connect();

// D-06: heartbeat every 5s (presence / last-seen)
setInterval(() => {
  conn.send({
    type: "player.heartbeat",
    deviceId: credentials.deviceId,
    position: state.position,
    status: state.status,
  });
}, config.heartbeatMs);

// D-06: authoritative state report every 2s while playing
setInterval(async () => {
  if (state.status === "playing") {
    state.position = await mpv.getTimePos().catch(() => state.position);
    state.duration = await mpv.getDuration().catch(() => state.duration); // real duration (mpv knows it even for oEmbed tracks)
    conn.send({ type: "player.state", report: state.toReport(credentials.deviceId) });
  }
}, config.stateReportMs);

// §25: track ended → server decides what plays next.
// Only a natural end ("eof") or a hard playback error advances the queue.
// "stop"/"redirect" happen when the server itself replaced the track
// (player.load) — forwarding those would loop through the whole queue.
mpv.on("end-file", (reason: string) => {
  if (reason === "eof" || reason === "error") {
    conn.send({ type: "player.trackEnded", deviceId: credentials.deviceId });
  }
});

mpv.on("error", (err) => {
  console.error("[player] mpv error:", err instanceof Error ? err.message : err);
});

async function pair(cfg: PlayerConfig, code: string): Promise<{ deviceId: string; token: string }> {
  // HTTP base = origin only — serverUrl may carry a WS path (e.g. /ws/player)
  const u = new URL(cfg.serverUrl);
  const httpUrl = `${u.protocol === "wss:" ? "https" : "http"}://${u.host}`;
  const res = await fetch(`${httpUrl}/api/player/pair`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ pairingCode: code, name: cfg.deviceName, type: cfg.deviceType }),
  });
  if (!res.ok) {
    console.error("[player] pairing failed:", await res.text());
    process.exit(1);
  }
  const data = (await res.json()) as { deviceId: string; token: string };
  saveCredentials(data.deviceId, data.token);
  return data;
}
