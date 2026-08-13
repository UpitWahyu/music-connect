# PRD — Music Connect
## Spotify Connect-like Self-Hosted Music System

**Version:** 1.1  
**Date:** 2026-08-07  
**Status:** Final — Architecture Baseline (decisions locked, see §41 Decision Log)

---

## 1. Product Overview

Music Connect is a self-hosted, Spotify Connect-like music control system built with Node.js.

The core concept is to separate:

1. **Controller devices** — phones, tablets, desktops, or browsers used to control playback.
2. **Player devices** — PCs, Android devices, TVs, or other devices physically connected to speakers/headphones.
3. **Control Server** — central Node.js service responsible for authentication, device management, queue management, playback state, and realtime communication.
4. **Redis** — ephemeral realtime state, device presence, queues, distributed locks, and caches. Realtime delivery to controllers/players uses **WebSocket** (see §38), not Redis pub/sub.
5. **Music Providers** — adapters such as YouTube Music.
6. **Playback Engines** — adapters such as mpv.

The controller does not carry the audio stream. The selected player device performs the actual playback.

### Core concept

```text
Controller
   │
   │ HTTPS / WebSocket
   ▼
Music Server
   │
   │ WebSocket (state/commands)
   ▼
Player Agent
   │
   ▼
Playback Engine (mpv)
   │
   ▼
Speaker / Headphones
```

---

# 2. Goals

## Primary Goals

- Allow a user to select a playback device remotely.
- Play music through the selected device.
- Control playback from another device.
- Support multiple player devices.
- Keep playback state synchronized across all controllers.
- Support play, pause, resume, seek, next, previous, volume, queue, shuffle, and repeat.
- Support YouTube Music as a music metadata/search provider.
- Allow device handoff without restarting playback from the beginning.
- Keep audio traffic out of the central server whenever possible.
- Provide a clean Web UI suitable for mobile and desktop.
- Use Redis for realtime state, locks and caches; deliver realtime events over WebSocket.
- Make the architecture provider- and playback-engine agnostic.

## Secondary Goals

- Support persistent playlists and favorites.
- Support playback history.
- Support multiple users.
- Support future music providers.
- Support future playback engines.
- Support future synchronized multi-room playback.

---

# 3. Non-Goals for V1

The first version should NOT attempt to implement:

- Full Spotify-compatible protocol.
- Lossless audio transcoding server.
- Multi-room synchronized playback.
- Native iOS/Android applications.
- Social features.
- Recommendation algorithms.
- Music uploads.
- Public music sharing.
- Complex collaborative playlists.
- Direct exposure of mpv IPC to the Internet.

These can be considered after the core system is stable.

---

# 4. Target Architecture

```text
                         INTERNET / LAN
                              │
                              │
                   ┌──────────▼──────────┐
                   │     Controller      │
                   │                     │
                   │ Android / PC / Web  │
                   │                     │
                   │ Search              │
                   │ Queue               │
                   │ Play/Pause          │
                   │ Seek                │
                   │ Volume              │
                   │ Device selection    │
                   └──────────┬──────────┘
                              │
                         WebSocket
                              │
                              ▼
                 ┌────────────────────────┐
                 │     MUSIC SERVER       │
                 │        Node.js         │
                 │                        │
                 │ REST API               │
                 │ WebSocket              │
                 │ Auth                   │
                 │ Queue Manager          │
                 │ Playback Manager       │
                 │ Device Manager         │
                 │ Music Provider Layer   │
                 └───────────┬────────────┘
                             │
                         Redis Pub/Sub
                             │
                ┌────────────┼────────────┐
                │            │            │
                ▼            ▼            ▼
           Player #1    Player #2    Player #3
             PC           Android       TV
              │             │            │
             mpv           mpv       browser
              │             │            │
           Speaker       Speaker       TV
```

---

# 5. Architectural Principles

## 5.1 Control Plane vs Playback Plane

The system must separate control from audio playback.

### Control Plane

Responsible for:

- Authentication
- Device management
- Queue management
- Playback commands
- Playback state
- Search
- Metadata
- Realtime events

### Playback Plane

Responsible for:

- Resolving playable media
- Downloading/streaming media to the player
- Audio decoding
- Audio output
- Reporting actual playback state

This separation prevents the central server from becoming an unnecessary audio bandwidth bottleneck.

---

# 6. Components

## 6.1 Control Server

Technology:

- Node.js
- TypeScript
- Fastify or Express
- WebSocket
- Prisma
- MySQL
- Redis

Responsibilities:

- REST API
- WebSocket gateway
- Authentication
- Device registry
- Device presence
- Queue management
- Playback orchestration
- Music provider abstraction
- Redis pub/sub
- Persistent database access

---

## 6.2 Player Agent

A lightweight Node.js application installed on every playback device.

Responsibilities:

- Connect to Music Server.
- Authenticate using a device token.
- Register the player.
- Maintain WebSocket connection.
- Receive playback commands.
- Resolve playable media.
- Control mpv.
- Report playback state.
- Send heartbeat/presence information.

Example:

```text
PC
└── music-player
    ├── WebSocket client
    ├── resolver
    ├── state manager
    └── mpv controller
```

---

## 6.3 Controller UI

Web application built with:

- Vue 3
- Tailwind CSS v4

Responsibilities:

- Authentication
- Device selector
- Music search
- Now Playing UI
- Queue management
- Playback controls
- Volume
- Device transfer
- Playlists
- History

The controller does not directly communicate with mpv.

---

## 6.4 Redis

Redis is responsible for realtime/ephemeral data.

Use Redis for:

- Device presence
- Current playback state
- Queue
- Pub/sub
- Temporary sessions
- Realtime events

Do not use Redis as the permanent source of truth for user data.

---

## 6.5 MySQL

MySQL stores persistent data.

Suggested entities:

- User
- Device
- Playlist
- PlaylistTrack
- Favorite
- PlaybackHistory
- ProviderAccount
- UserSetting

---

# 7. Technology Stack

| Layer | Technology |
|---|---|
| Backend | Node.js + TypeScript |
| API | Fastify |
| Realtime | WebSocket |
| Cache / realtime state | Redis |
| Persistent DB | MySQL |
| ORM | Prisma |
| Frontend | Vue 3 |
| CSS | Tailwind CSS v4 |
| Music integration | youtubei.js |
| Playback engine | mpv |
| Process manager | PM2 |
| Deployment | Docker / Docker Compose |
| Reverse proxy | Nginx Proxy Manager or Nginx |

---

# 8. Monorepo Structure

```text
music-connect/
│
├── apps/
│   ├── server/
│   │   ├── src/
│   │   │   ├── api/
│   │   │   │   ├── auth.ts
│   │   │   │   ├── devices.ts
│   │   │   │   ├── search.ts
│   │   │   │   ├── queue.ts
│   │   │   │   └── playback.ts
│   │   │   │
│   │   │   ├── ws/
│   │   │   │   └── gateway.ts
│   │   │   │
│   │   │   ├── services/
│   │   │   │   ├── device.service.ts
│   │   │   │   ├── queue.service.ts
│   │   │   │   ├── playback.service.ts
│   │   │   │   └── music.service.ts
│   │   │   │
│   │   │   ├── providers/
│   │   │   │   └── youtube-music.ts
│   │   │   │
│   │   │   ├── redis/
│   │   │   │   ├── pub.ts
│   │   │   │   ├── sub.ts
│   │   │   │   └── keys.ts
│   │   │   │
│   │   │   ├── db/
│   │   │   │   └── prisma.ts
│   │   │   │
│   │   │   └── index.ts
│   │   └── package.json
│   │
│   ├── player/
│   │   ├── src/
│   │   │   ├── connection.ts
│   │   │   ├── commands.ts
│   │   │   ├── mpv.ts
│   │   │   ├── resolver.ts
│   │   │   ├── state.ts
│   │   │   └── index.ts
│   │   └── package.json
│   │
│   └── web/
│       ├── src/
│       │   ├── components/
│       │   │   ├── Player.vue
│       │   │   ├── Queue.vue
│       │   │   ├── DeviceSelector.vue
│       │   │   └── Search.vue
│       │   └── ...
│       └── package.json
│
├── packages/
│   ├── protocol/
│   ├── shared/
│   └── types/
│
├── prisma/
│   └── schema.prisma
│
├── docker-compose.yml
├── package.json
└── pnpm-workspace.yaml
```

---

# 9. Device Model

Each playback device receives a unique ID.

Examples:

```text
living-room
bedroom
desktop
android-phone
android-tv
```

Persistent database model:

```text
Device
---------
id
name
type
tokenHash
lastSeen
online
volume
createdAt
updatedAt
```

Runtime state belongs in Redis.

---

# 10. Device Pairing

Player devices should not authenticate using normal user passwords.

Recommended pairing flow:

```text
Server
  │
  ├── generates pairing code
  │
  ▼
123-456
  │
  ▼
Player Agent
  │
  ├── submits pairing code
  │
  ▼
Server
  │
  └── returns device token
```

The player stores the token locally.

Example:

```text
~/.config/music-player/credentials.json
```

On startup:

```text
connect
  ↓
authenticate
  ↓
register
  ↓
heartbeat
  ↓
ready
```

---

# 11. Playback Engine

mpv is the initial playback engine.

Launch example:

```bash
mpv \
  --no-video \
  --idle=yes \
  --input-ipc-server=/tmp/music-mpv.sock
```

The Player Agent communicates with mpv using JSON IPC.

Example command:

```json
{
  "command": [
    "set_property",
    "pause",
    false
  ]
}
```

Seek:

```json
{
  "command": [
    "seek",
    30,
    "absolute"
  ]
}
```

Volume:

```json
{
  "command": [
    "set_property",
    "volume",
    70
  ]
}
```

The mpv IPC socket must remain local and must never be directly exposed to the Internet.

---

# 12. Playback Engine Abstraction

Do not hardcode mpv throughout the application.

Use an interface:

```ts
interface PlaybackEngine {
  play(track: ResolvedTrack): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  seek(position: number): Promise<void>;
  stop(): Promise<void>;
  setVolume(volume: number): Promise<void>;
  getState(): Promise<PlaybackState>;
}
```

Initial implementation:

```text
playback/
├── mpv.ts
└── ...
```

Future implementations may include:

```text
browser.ts
android.ts
other-player.ts
```

---

# 13. Music Provider Abstraction

Music providers must also be abstracted.

```ts
interface MusicProvider {
  search(query: string): Promise<Track[]>;
  getTrack(id: string): Promise<Track>;
  getAlbum(id: string): Promise<Album>;
  getArtist(id: string): Promise<Artist>;
  getPlaylist(id: string): Promise<Playlist>;
}
```

Initial provider:

```text
providers/
└── youtube-music.ts
```

Future providers:

```text
spotify.ts
soundcloud.ts
local.ts
radio.ts
```

---

# 14. YouTube Music Integration

Use `youtubei.js` as the initial YouTube/YouTube Music integration layer.

Responsibilities:

- Search
- Track metadata
- Album metadata
- Artist metadata
- Playlist metadata
- Account/session integration where required

The application should not expose raw youtubei.js objects to the frontend.

Normalize results into internal DTOs.

Example:

```json
{
  "id": "youtube-video-id",
  "title": "Blinding Lights",
  "artist": "The Weeknd",
  "album": "After Hours",
  "duration": 200,
  "thumbnail": "..."
}
```

Important implementation constraint:

YouTube internal APIs are not equivalent to the official public YouTube Data API. The YouTube Music integration must therefore be isolated behind the provider abstraction so it can be replaced or updated independently.

---

# 15. Media Resolution

Do not permanently store temporary streaming URLs.

Store stable identifiers such as:

```json
{
  "youtubeId": "xxxxxxxx"
}
```

rather than:

```json
{
  "url": "temporary-stream-url"
}
```

The reason is that media URLs can expire.

Preferred architecture:

```text
Server
   │
   │ track ID + metadata
   ▼
Player Agent
   │
   │ resolve playable media
   ▼
YouTube / provider
   │
   ▼
mpv
```

This keeps playback close to the player device.

---

# 16. Playback State

Redis key:

```text
music:device:living-room:state
```

Example:

```json
{
  "deviceId": "living-room",
  "state": "playing",
  "track": {
    "id": "xxx",
    "title": "Blinding Lights",
    "artist": "The Weeknd",
    "album": "After Hours",
    "duration": 200,
    "thumbnail": "..."
  },
  "position": 83.2,
  "volume": 70,
  "queueIndex": 2,
  "updatedAt": 1786100000000
}
```

---

# 17. Position Synchronization

Do not send playback position every 100 ms.

Store:

```json
{
  "position": 84,
  "updatedAt": 1786100000000,
  "state": "playing"
}
```

A controller calculates current position:

```js
currentPosition =
  state === 'playing'
    ? position + (Date.now() - updatedAt) / 1000
    : position;
```

The player can periodically report an authoritative position, e.g. every few seconds.

---

# 18. Player Heartbeat

Player sends a heartbeat periodically, for example every 5 seconds.

Example:

```json
{
  "event": "PLAYER_STATE",
  "deviceId": "living-room",
  "state": "playing",
  "position": 92.31
}
```

The server updates:

- Redis playback state
- device last-seen timestamp
- online status

Then publishes an event to connected controllers.

---

# 19. Redis Key Design

Recommended keys:

```text
music:device:{deviceId}:state
music:device:{deviceId}:queue
music:devices:online
music:events
music:commands:{deviceId}
```

Example:

```text
music:device:living-room:state
music:device:living-room:queue
music:commands:living-room
```

---

# 20. Redis Pub/Sub

Server publishes commands:

```js
await redis.publish(
  'music:commands:living-room',
  JSON.stringify({
    type: 'player.play',
    trackId: 'abc'
  })
);
```

Player Agent subscribes to its device-specific command channel.

Concept:

```text
Redis
  │
  ├── Player living-room
  ├── Player bedroom
  └── Player TV
```

Each player only receives commands intended for it.

---

# 21. WebSocket Architecture

WebSocket is used for realtime controller communication.

Example endpoint:

```text
wss://music.example.com/ws
```

Server events:

```json
{
  "type": "device.state",
  "deviceId": "living-room",
  "state": {
    "state": "playing",
    "position": 121.4
  }
}
```

Queue event:

```json
{
  "type": "queue.updated",
  "deviceId": "living-room",
  "queue": []
}
```

Device event:

```json
{
  "type": "device.updated",
  "device": {
    "id": "living-room",
    "online": false
  }
}
```

---

# 22. WebSocket Protocol

Client → Server:

```ts
type ClientEvent =
  | {
      type: 'device.register';
      deviceId: string;
    }
  | {
      type: 'player.play';
      deviceId: string;
      trackId: string;
    }
  | {
      type: 'player.pause';
      deviceId: string;
    }
  | {
      type: 'player.seek';
      deviceId: string;
      position: number;
    }
  | {
      type: 'player.next';
      deviceId: string;
    }
  | {
      type: 'player.previous';
      deviceId: string;
    }
  | {
      type: 'player.volume';
      deviceId: string;
      volume: number;
    };
```

Server → Client:

```ts
type ServerEvent =
  | {
      type: 'player.state';
      state: PlaybackState;
    }
  | {
      type: 'device.updated';
      device: Device;
    }
  | {
      type: 'queue.updated';
      deviceId: string;
      queue: QueueItem[];
    }
  | {
      type: 'error';
      code: string;
      message: string;
    };
```

---

# 23. Command Flow

Example: user presses Play.

```text
PHONE
 │
 │ player.play
 ▼
SERVER
 │
 ├── validate authentication
 ├── check device online
 ├── update state
 │
 └── Redis PUBLISH
          │
          ▼
      PLAYER AGENT
          │
          ▼
         mpv
          │
          ▼
        AUDIO
```

Then:

```text
mpv
 │
 │ playback state
 ▼
Player Agent
 │
 ▼
Server
 │
 ├── Redis
 │
 └── WebSocket
       │
       ├── Phone #1
       ├── Phone #2
       └── Desktop
```

---

# 24. Queue

Queue must be controlled by the server, not only the frontend.

Redis key:

```text
music:queue:{deviceId}
```

Example:

```json
[
  {
    "id": "abc",
    "title": "Song A",
    "artist": "Artist A"
  },
  {
    "id": "def",
    "title": "Song B",
    "artist": "Artist B"
  },
  {
    "id": "ghi",
    "title": "Song C",
    "artist": "Artist C"
  }
]
```

Required queue operations:

- Add
- Remove
- Reorder
- Play now
- Play next
- Clear
- Shuffle
- Repeat
- Move current track

---

# 25. Auto Next

When a track finishes:

```text
current track
     ↓
playback ended
     ↓
Queue Manager
     ↓
next queue item
     ↓
resolve media
     ↓
Player Agent
     ↓
mpv
```

The player should report an explicit `track.ended` event.

The server then decides which track comes next.

---

# 26. Device Handoff

A core Spotify Connect-like feature.

Example:

```text
Current:

Living Room
▶ Blinding Lights
1:32 / 3:20
```

User selects:

```text
Bedroom
```

Server:

```text
get state(living-room)
        ↓
track ID
position
volume
state
        ↓
stop living-room
        ↓
play bedroom at same position
```

Protocol:

```json
{
  "type": "device.transfer",
  "from": "living-room",
  "to": "bedroom"
}
```

The target player starts at the current playback position.

---

# 27. Multi-Room Synchronization

Not required for V1.

Future design:

```json
{
  "trackId": "abc",
  "startAt": 1786100005000
}
```

Players synchronize against a common timestamp.

Potential architecture:

```text
Living Room ─┐
Bedroom ─────┼──► common playback clock
TV ──────────┘
```

This should be implemented only after single-device handoff is stable.

---

# 28. REST API

Suggested endpoints:

```text
POST   /api/auth/login

GET    /api/devices
POST   /api/devices/:id/pair
DELETE /api/devices/:id

GET    /api/music/search?q=
GET    /api/music/tracks/:id
GET    /api/music/albums/:id
GET    /api/music/artists/:id
GET    /api/music/playlists/:id

GET    /api/devices/:id/state

GET    /api/devices/:id/queue
POST   /api/devices/:id/queue
DELETE /api/devices/:id/queue/:index

POST   /api/devices/:id/play
POST   /api/devices/:id/pause
POST   /api/devices/:id/next
POST   /api/devices/:id/previous
POST   /api/devices/:id/seek
POST   /api/devices/:id/volume

POST   /api/devices/:id/transfer
```

---

# 29. Data Model

Suggested Prisma models:

```text
User
Device
Playlist
PlaylistTrack
Favorite
PlaybackHistory
ProviderAccount
UserSetting
```

Potential relations:

```text
User
 ├── Devices
 ├── Playlists
 ├── Favorites
 ├── PlaybackHistory
 └── ProviderAccounts
```

---

# 30. Security

## Controller

- User authentication
- JWT or secure session
- WebSocket authentication
- Authorization for device commands

## Player

- Per-device authentication token
- Token stored securely on device
- Pairing code for initial registration
- Token rotation/revocation

## Network

- HTTPS
- WSS
- Reverse proxy
- Redis must not be public
- MySQL must not be public
- mpv IPC must remain local

---

# 31. Error Handling

The server must handle:

### Player offline

```text
PLAYER_OFFLINE
```

Controller shows:

```text
Living Room
Offline
```

### Playback failure

```text
PLAYBACK_FAILED
```

The server can:

1. Retry resolution.
2. Re-resolve the media.
3. Skip the track.
4. Move to next queue item.

### Expired media URL

Do not retry the same URL indefinitely.

Instead:

```text
expired URL
   ↓
resolve again
   ↓
new URL
   ↓
play
```

### WebSocket disconnect

Player should automatically reconnect with exponential backoff.

---

# 32. Reconnection

Player Agent:

```text
connected
   │
disconnect
   │
1 sec
   │
retry
   │
2 sec
   │
retry
   │
4 sec
   │
retry
   │
max delay
```

After reconnection:

```text
authenticate
register
report current state
receive current server state
synchronize
```

---

# 33. Controller UI

Primary UI:

```text
┌──────────────────────────────────────────────┐
│ Music Connect                    Living Room │
├──────────────────────────────────────────────┤
│                                              │
│ 🔎 Search YouTube Music                     │
│                                              │
│ Blinding Lights                             │
│ The Weeknd                              [+] │
│                                              │
│ ┌──────────────────────────────────────────┐ │
│ │              Album Art                   │ │
│ │                                          │ │
│ │           Blinding Lights                │ │
│ │           The Weeknd                     │ │
│ │                                          │ │
│ │        1:32 ━━━━━●━━ 3:20               │ │
│ │                                          │ │
│ │          ◀    ❚❚    ▶                   │ │
│ │                                          │ │
│ │       🔊 ━━━━━━━━━●                      │ │
│ └──────────────────────────────────────────┘ │
│                                              │
│ Queue                                        │
│ 1  Starboy                                  │
│ 2  Blinding Lights              ▶           │
│ 3  Save Your Tears                          │
└──────────────────────────────────────────────┘
```

Device selector:

```text
Playing on

● Living Room
○ Bedroom
○ Desktop
○ Android TV
```

---

# 34. Suggested UX

The controller should always make the active device obvious.

Example:

```text
🎵 Playing on Living Room
```

If no player is selected:

```text
Select a device
```

If the selected device is offline:

```text
Living Room is offline
```

The current track and playback state should remain visible even if the controller is temporarily disconnected.

---

# 35. Phase-Based Development

## Phase 1 — Player

Build:

```text
Node.js
  ↓
mpv
  ↓
Speaker
```

Features:

- Play
- Pause
- Resume
- Seek
- Volume
- State

---

## Phase 2 — Control Server

Build:

```text
Player
   ↕
WebSocket
   ↕
Node.js Server
```

Features:

- Device registration
- Authentication
- Heartbeat
- Commands
- Playback state

---

## Phase 3 — Redis

Build:

```text
Server
 │
 Redis
 │
 Player
```

Features:

- State
- Queue
- Pub/sub
- Presence

---

## Phase 4 — Web Controller

Build:

```text
Phone
 │
WebSocket
 │
Server
 │
Player
```

Features:

- Device selection
- Now Playing
- Controls
- Queue

At this point the system already behaves like a basic Spotify Connect-style remote player.

---

## Phase 5 — YouTube Music

Add youtubei.js provider:

```text
Search
Track metadata
Album
Artist
Playlist
```

---

## Phase 6 — Queue

Add:

- Add
- Remove
- Reorder
- Play now
- Play next
- Shuffle
- Repeat

---

## Phase 7 — Device Handoff

Add:

```text
Living Room
      ↓
Bedroom
```

with playback position preservation.

---

## Phase 8 — Persistent Features

Add:

- Playlists
- Favorites
- History
- User settings

---

## Phase 9 — Advanced Features

Possible future additions:

- Multi-room sync
- Native Android app
- Offline local library
- Additional music providers
- Voice control
- Chromecast support

---

# 36. MVP Definition of Done

The MVP is complete when all of the following work:

- [ ] Player Agent can connect to server.
- [ ] Player can be paired.
- [ ] Server knows player online/offline state.
- [ ] Controller can see available devices.
- [ ] Controller can select a device.
- [ ] Controller can start playback.
- [ ] Audio plays on selected device.
- [ ] Controller can pause/resume.
- [ ] Controller can seek.
- [ ] Controller can change volume.
- [ ] Playback state updates in realtime.
- [ ] Multiple controllers see the same state.
- [ ] Queue is server-managed.
- [ ] Track ending advances the queue.
- [ ] Player reconnects automatically.
- [ ] Device handoff works.
- [ ] YouTube Music search works.
- [ ] YouTube Music track metadata is normalized.
- [ ] Temporary playback URLs are not permanently stored.
- [ ] Redis and database are not publicly exposed.
- [ ] mpv IPC is not publicly exposed.

---

# 37. Recommended Initial Deployment

For development:

```text
Docker Compose
├── music-server
├── redis
└── mysql
```

Player:

```text
PC
├── Node.js Player Agent
└── mpv
```

Controller:

```text
Browser
└── Vue Web App
```

Production:

```text
Internet
   │
Cloudflare / Reverse Proxy
   │
   ▼
Music Server
   ├── Redis
   └── MySQL

LAN / Internet
   │
   ├── Player PC
   ├── Android Player
   └── TV Player
```

---

# 38. Initial Repository Package Plan

Use pnpm workspace.

```json
{
  "name": "music-connect",
  "private": true,
  "packageManager": "pnpm"
}
```

Workspace:

```text
apps/server
apps/player
apps/web

packages/protocol
packages/shared
packages/types
```

The `protocol` package should be shared by:

- Server
- Player Agent
- Controller

This prevents event schemas from diverging.

---

# 39. Key Design Decision

The most important architectural decision is:

```text
Controller ≠ Player
```

The controller only sends commands.

The player produces audio.

Therefore:

```text
Phone can disconnect
        ↓
Music keeps playing
```

and:

```text
Phone #1
Phone #2
PC
Tablet
        ↓
same server
        ↓
same player
```

All controllers can operate the same playback session.

---

# 40. Final Architecture

```text
                              ┌───────────────┐
                              │   Android     │
                              │   Controller  │
                              └───────┬───────┘
                                      │
                              WebSocket/HTTPS
                                      │
                                      ▼
┌────────────────────────────────────────────────────────┐
│                    MUSIC SERVER                        │
│                                                        │
│  Auth ─ Device Manager ─ Queue Manager ─ Playback     │
│                           │             │              │
│                           │             │              │
│                    YouTube Music       Redis           │
│                           │             │              │
└───────────────────────────┼─────────────┼──────────────┘
                            │             │
                            │             │ Pub/Sub
                            │             │
              ┌─────────────┴─────────────┴──────────┐
              │                                      │
              ▼                                      ▼
      ┌─────────────────┐                    ┌─────────────────┐
      │ Player Agent #1 │                    │ Player Agent #2 │
      │                 │                    │                 │
      │ Resolver        │                    │ Resolver        │
      │ WebSocket       │                    │ WebSocket       │
      │ mpv             │                    │ mpv             │
      └────────┬────────┘                    └────────┬────────┘
               │                                      │
               ▼                                      ▼
           Speaker #1                             Speaker #2
```

## Architectural rule

```text
CONTROL PLANE
Node.js + Redis + WebSocket
        │
        ▼
PLAYBACK PLANE
Player Agent + mpv
        │
        ▼
AUDIO OUTPUT
```

This architecture is intended to be the baseline implementation for a self-hosted Spotify Connect-like system with YouTube Music integration.

---

# 41. Decision Log v1.1

Decisions from the architecture review (2026-08-07). Each entry refines or
overrides the corresponding section above.

## D-01 — Media playback strategy (refines §15)

Use **mpv + yt-dlp** as the default resolution path. The Player Agent passes a
YouTube video ID to mpv and lets mpv/yt-dlp resolve and stream directly from
YouTube (no central-server bandwidth). The Resolver supports a **dual-mode
protocol** so a native Android player (ExoPlayer) can join later:

```ts
// mode "id" — mpv + yt-dlp resolves (V1: desktop & Termux)
{ "mode": "id", "youtubeId": "xxx" }
// mode "url" — server provides a resolved stream URL (future: native Android)
{ "mode": "url", "url": "https://..." }
```

youtubei.js stays server-side for search/metadata/queue only.

## D-02 — Command transport (replaces §20 Redis Pub/Sub)

Player commands are delivered over the player's **existing WebSocket
connection** (server → player WS push). Redis pub/sub is NOT used for command
delivery in V1. Redis keeps its role for shared state, presence and queues.
Redis pub/sub for commands becomes relevant only if the server scales
horizontally.

## D-03 — Users

**Single user** for V1 (JWT auth on the web controller). The DB schema is
multi-user-ready. Player devices authenticate with per-device tokens via
pairing codes, never with the user password.

## D-04 — Deployment

- Server + Redis + MySQL: on the VPS, reverse-proxied (Nginx Proxy Manager +
  Cloudflare) under a subdomain (e.g. `music.example.com`), HTTPS/WSS.
- Players: PC (mpv) and **Android via Termux** (Node.js + mpv). Manual start —
  **no auto-start** on the player side.
- mpv IPC: unix socket on Linux/Termux, named pipe on Windows.

## D-05 — Queue persistence

Queue lives in **Redis only** (ephemeral, acceptable). Persistent playlists,
favorites and history live in MySQL.

## D-06 — Reporting cadence (locks §18)

- Heartbeat: every 5 s.
- State report: every 2 s while `playing`, immediately on events
  (pause / seek / track change).
- Controllers interpolate position from `position` + `updatedAt` (§17).

## D-07 — WebSocket auth (adds to §30)

Browser WebSocket clients cannot set custom headers, and query-string tokens
leak into access logs. Use **first-message auth**: connect, send the token as
the first message, the server validates before granting subscriptions. REST
keeps `Authorization: Bearer`.

## D-08 — Authority on reconnect

- Server = authority for queue & current track.
- Player = authority for actual position.
- On reconnect: server sends the track to play, player reports its position.

## D-09 — YouTube API protection

Cache search results (TTL ~5 min) and metadata (TTL ~24 h) in Redis to avoid
youtubei.js throttling/rate limits.

## D-10 — Device pairing hardening (adds to §30)

Pairing codes: 5-minute TTL, one-time use, regenerate after 3 wrong attempts.
Login endpoint rate-limited (e.g. 5 attempts/min/IP).

## D-11 — Handoff (adds to §26)

Volume is per-device. On transfer, the playback position carries over; the
target device uses its own stored volume (Spotify-like).

## D-12 — Observability & testing

- `/healthz` health endpoint; report to Tianji.
- Vitest: unit tests for the Queue Manager (auto-next, shuffle, repeat,
  handoff) + one WebSocket integration test.

## D-14 — Persistent library & auth guard (Phase 8)

All `/api/*` routes require a JWT (global `onRequest` hook; exceptions:
`/api/auth/login`, `/api/player/pair`, `/healthz`, and `/ws/*` which has its
own first-message auth). Playlists, favorites and playback history persist in
MySQL (§29): playlist rows store track snapshot metadata with stable provider
ids (§15 — never temporary URLs). Playing a saved playlist replaces the queue
with the same Spotify semantics as YT playlists. History is recorded on every
track load; `device.userId` is captured at pairing time (stored with the
pairing code in Redis, written to the Device row on submit).

## D-15 — Device handoff UI (Phase 7)

Handoff (§26) is reachable from the controller UI ("⇄ Pindahkan ke" in the
player card): position carries over, the target keeps its own volume (D-10).
Remote wake-up (WOL via MikroTik) was removed — see git history.

## D-13 — Auto-queue recommendations (extends §24, §25)

When the queue runs low (`remaining <= AUTO_QUEUE_THRESHOLD`, default 2) the
server fetches YT Music "Up Next" recommendations seeded from the current
track and appends them as `addedBy: "auto"` (deduped against the queue).
Auto-next (§25) advances the server-managed queue; if the queue is exhausted
it refills from recommendations first, so playback never stops. Config:
`AUTO_QUEUE_THRESHOLD` (default 2), `AUTO_QUEUE_BATCH` (default 10).
Recommendations are cached in Redis (10 min, D-09).
