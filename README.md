# Music Connect

Self-hosted, Spotify Connect-style music control system built with Node.js.

**Controller ≠ Player**: the controller (web UI) sends commands over WebSocket,
the player agent (mpv on a PC / phone / TV) produces the audio.

```
Controller ──WS──▶ Music Server ──WS──▶ Player Agent ──JSON IPC──▶ mpv ──▶ Speaker
                        │
                    Redis (state/presence/queue) + MySQL (persistent)
```

## Architecture

- **apps/server** — Fastify REST + WebSocket gateway, JWT auth, queue/playback services
- **apps/player** — WS client + mpv controller (runs on PC / Android Termux / Android TV)
- **apps/web** — Vue 3 + Tailwind v4 controller UI (Indonesian & English)
- **packages/protocol** — shared WS/command wire types
- **packages/shared** — Redis key helpers, position interpolation
- **packages/types** — domain entities

## Features

- Search YouTube Music, play songs/playlists, per-account global queue
- Drag & drop / move queue reordering, synced live across every open browser
- Favorites & playlists (persistent, MySQL), play history
- **Handoff**: switch playback between devices without restarting the track
  (position carries over); per-device volume
- Wake-on-LAN remote power-on for PC players (optional)
- DB-backed credentials: change username/password from the Settings page;
  pairing codes for new player devices

## Quickstart (development)

```bash
pnpm install
docker compose up -d mysql redis
cp .env.example .env     # fill in JWT_SECRET + DATABASE_URL
pnpm db:generate
pnpm build
pnpm dev:server
pnpm dev:web
```

Run the player on any machine with mpv installed:

```bash
cd apps/player
PAIRING_CODE=123-456 pnpm dev   # first run only (pairing code from Settings page)
pnpm dev                        # afterwards
```

## Player setup

See [docs/RUNBOOK-PLAYER.md](docs/RUNBOOK-PLAYER.md) for the full guide
(prerequisites per OS, pairing, env vars, auto-start, troubleshooting).

## Key decisions (PRD §41)

- **D-01** mpv + yt-dlp plays the media; resolver is dual-mode (`id` / `url`)
- **D-02** commands travel over the player's WebSocket — Redis pub/sub is for scaling
- **D-06** heartbeat 5s, state report 2s while playing, immediate on events
- **D-07** WebSocket first-message auth (no token in query string)
- **D-08** server owns queue/track, player owns position

Full spec & decision log: [docs/PRD.md](docs/PRD.md)
