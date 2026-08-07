# Music Connect

Self-hosted, Spotify Connect-like music control system built with Node.js.
Controller ≠ Player: the controller sends commands, the player produces audio.

See [docs/PRD.md](docs/PRD.md) — v1.1, decisions locked in §41 Decision Log.

## Architecture

```
Controller ──WS──▶ Music Server ──WS──▶ Player Agent ──JSON IPC──▶ mpv ──▶ Speaker
                        │
                    Redis (state/presence/queue) + MySQL (persistent)
```

- **apps/server** — Fastify REST + WebSocket gateway, auth, queue/playback services
- **apps/player** — WS client + mpv controller (runs on PC / Android Termux)
- **apps/web** — Vue 3 + Tailwind v4 controller UI
- **packages/protocol** — shared WS/command wire types (never diverge)
- **packages/shared** — Redis key helpers, position interpolation
- **packages/types** — domain entities

## Quickstart (development)

```bash
pnpm install
docker compose up -d mysql redis
cp .env.example .env
pnpm db:generate
pnpm build
pnpm dev:server
pnpm dev:web
```

Player (on the playback machine, with mpv installed):

```bash
cd apps/player
PAIRING_CODE=123-456 pnpm dev   # first run only
pnpm dev                        # afterwards
```

## Key decisions (PRD §41)

- **D-01** mpv + yt-dlp plays the media; resolver is dual-mode (`id` / `url`)
- **D-02** commands travel over the player's WebSocket — Redis pub/sub is for scaling
- **D-06** heartbeat 5s, state report 2s while playing, immediate on events
- **D-07** WebSocket first-message auth (no token in query string)
- **D-08** server owns queue/track, player owns position
