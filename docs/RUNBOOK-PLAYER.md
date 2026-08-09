# Runbook — Music Player Agent

Install the player on a PC / laptop / Android device to play music from
Music Connect. The player is a lightweight Node.js agent that controls
**mpv**; audio comes out of this device, not the server.

```
Web / Phone ──wss──▶ YOUR_SERVER ──▶ server :3019 ──command──▶ player agent ──▶ mpv ──▶ speaker
```

---

## 1. Prerequisites

| Device | Node.js | pnpm | mpv | yt-dlp |
|---|---|---|---|---|
| Linux | 20+ | 9+ | `apt install mpv` | `apt install yt-dlp` |
| Windows | 20+ | 9+ | `winget install mpv` | `winget install yt-dlp` |
| macOS | 20+ | 9+ | `brew install mpv` | `brew install yt-dlp` |
| Android (Termux) | `pkg install nodejs-lts` | `npm i -g corepack@latest && corepack enable pnpm` | `pkg install mpv` | `pkg install yt-dlp` |

> mpv 0.35+ has yt-dlp *built in*; install yt-dlp separately if YouTube
> resolution fails. On Termux, audio can be grabbed by other apps — run
> `termux-wake-lock` so the process is not suspended.

**Install pnpm (recommended):**

```bash
npm install -g corepack@latest
corepack enable pnpm
```

> If `pnpm` is still missing after `corepack enable`, run
> `corepack prepare pnpm@latest --activate`. On Windows, version-manager
> shims in npm's global bin can conflict with corepack — remove stale
> `pnpm*` shims (or use `winget install pnpm.pnpm`) if needed.

Verify everything is installed:

```bash
node -v && pnpm -v && mpv --version | head -1 && yt-dlp --version
```

## 2. Get the player code

```bash
git clone <YOUR_REPO_URL>
cd music-connect
pnpm install                     # workspace: types/protocol/shared
# build internal libraries first (dist/ is missing on a fresh clone)
pnpm --filter @music-connect/types --filter @music-connect/protocol --filter @music-connect/shared build
pnpm --filter @music-connect/player build
```

## 3. Pairing (once)

Generate a pairing code from the **Settings page** of the web UI (Pairing
Code section) or from any machine with server access:

```bash
MUSIC_PASSWORD=xxx ./scripts/pair-device.sh desktop <YOUR_SERVER_URL>
# → Pairing code for 'desktop': 123-456 (valid 5 minutes, single use)
```

Then, on the player machine, run once with that code:

```bash
cd music-connect/apps/player
PAIRING_CODE=123-456 pnpm start
```

The device token is stored automatically in
`~/.config/music-player/credentials.json`
(Linux/macOS) or `%USERPROFILE%\.config\music-player\credentials.json`
(Windows). Subsequent runs do not need pairing again.

## 4. Run the player (normal)

```bash
cd music-connect/apps/player
pnpm start
```

### Env vars (all optional except during pairing)

| Var | Default | Notes |
|---|---|---|
| `MUSIC_SERVER_URL` | `ws://localhost:3000` | **Required for remote**: `wss://YOUR_SERVER/ws/player` |
| `DEVICE_ID` | `desktop` | Unique device id (shown in the web UI) |
| `DEVICE_NAME` | `Desktop` | Friendly name (e.g. `Living Room`) |
| `DEVICE_TYPE` | `desktop` | `desktop` / `android` / `tv` |
| `PAIRING_CODE` | – | Only for first-time pairing |
| `MPV_BIN` | `mpv` | Path to the mpv binary (portable builds, Termux) |
| `MPV_IPC` | `~/.music-mpv.sock` (unix) / named pipe (Windows) | mpv IPC endpoint; can be a unix socket path or `host:port` |
| `HEARTBEAT_MS` | `5000` | Presence heartbeat |
| `STATE_REPORT_MS` | `2000` | Position report while playing |

Example:

```bash
MUSIC_SERVER_URL=wss://YOUR_SERVER/ws/player \
DEVICE_ID=living-room DEVICE_NAME="Living Room" \
pnpm start
```

## 5. Auto-start (optional)

**Linux (systemd user):** `~/.config/systemd/user/music-player.service`

```ini
[Unit]
Description=Music Connect Player
After=network-online.target

[Service]
Type=simple
WorkingDirectory=/home/USER/music-connect/apps/player
Environment=MUSIC_SERVER_URL=wss://YOUR_SERVER/ws/player
Environment=DEVICE_ID=living-room
ExecStart=/usr/bin/node /home/USER/music-connect/apps/player/dist/index.js
Restart=on-failure
RestartSec=3

[Install]
WantedBy=default.target
```

```bash
systemctl --user daemon-reload
systemctl --user enable --now music-player
```

**Windows:** create a shortcut → `Target: pnpm start` in the `shell:startup`
folder, or use Task Scheduler / PM2.

**Android Termux:** run manually (no auto-start) — run `termux-wake-lock`
before starting so the process is not suspended.

## 6. Troubleshooting

| Symptom | Fix |
|---|---|
| `mpv: command not found` | Install mpv (section 1) or set `MPV_BIN` / `PATH` |
| `No credentials found` | Run once with `PAIRING_CODE` (section 3) |
| `INVALID_OR_EXPIRED_CODE` | Codes are single-use with a 5-min TTL → generate a new one |
| WS error / won't connect | Check `MUSIC_SERVER_URL` (must be `wss://.../ws/player`); test `curl https://YOUR_SERVER/healthz` |
| `mpv not connected` | mpv not started / IPC failed — check `MPV_BIN`, `MPV_IPC`, and `[mpv]` stderr logs |
| No sound | Check mpv volume, Termux/Windows audio sink |
| Track won't resolve | `yt-dlp https://music.youtube.com/watch?v=xxx` manually to verify |
| Lost/corrupt token | Delete `credentials.json` → pair again |
| Update | `git pull && pnpm install && pnpm --filter @music-connect/player build && restart` |

## 7. Automatic behavior

- ✅ Exponential reconnect (1s → 2s → 4s → max) if the WS drops
- ✅ 5s heartbeat → device shows 🟢 in the web UI
- ✅ 2s position reports while playing (server → all controllers stay in sync)
- ✅ Auto-next: track ends → server picks the next (queue/recommendations)
- ✅ Handoff: move playback to this device without restarting the track
- ✅ Never crashes on mpv errors (all command errors are logged only)
