import { beforeAll, afterAll, describe, it, expect } from "vitest";
import "dotenv/config";
import WebSocket from "ws";
import type { AddressInfo } from "node:net";
import { redis, connectRedis } from "../redis/client.js";
import { prisma } from "../db/prisma.js";
import { buildApp } from "../app.js";
import { hashPassword } from "../api/auth.js";
import { sha256 } from "../utils.js";
import { deviceService } from "../services/device.service.js";
import type { FastifyInstance } from "fastify";
import type { Track } from "@music-connect/types";

let app: FastifyInstance;
let port: number;
let controllerToken: string;

const USER = "test-e2e-user";
const DEVICE = "test-device-e2e";
const DEVICE_B = "test-device-e2e-b";
const DEVICE_C = "test-device-e2e-c";
const DEV_TOKEN = "devtoken123";
const DEV_TOKEN_B = "devtoken123-b";
const DEV_TOKEN_C = "devtoken123-c";

/** Minimal fake mpv agent speaking the real WS protocol. */
class FakePlayer {
  private ws: WebSocket;
  private queue: Record<string, unknown>[] = [];
  private waiters: { type: string; resolve: (m: unknown) => void; timer: NodeJS.Timeout }[] = [];
  opened: Promise<void>;
  closed: Promise<number>;

  constructor(url: string) {
    this.ws = new WebSocket(url);
    this.opened = new Promise((res, rej) => {
      this.ws.once("open", () => res());
      this.ws.once("error", rej);
    });
    this.closed = new Promise((res) => this.ws.once("close", (code) => res(code)));
    this.ws.on("message", (data) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(String(data)) as Record<string, unknown>;
      } catch {
        return;
      }
      const idx = this.waiters.findIndex((w) => w.type === msg.type);
      if (idx >= 0) {
        const [w] = this.waiters.splice(idx, 1);
        clearTimeout(w.timer);
        w.resolve(msg);
      } else {
        this.queue.push(msg);
      }
    });
  }

  send(obj: unknown): void {
    this.ws.send(JSON.stringify(obj));
  }

  async auth(deviceId: string, token: string): Promise<void> {
    this.send({ type: "player.auth", deviceId, token });
  }

  /** Resolve the next server command/event of the given type. */
  async next(type: string, timeout = 5000): Promise<Record<string, unknown>> {
    const qi = this.queue.findIndex((m) => m.type === type);
    if (qi >= 0) return this.queue.splice(qi, 1)[0]!;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w.timer !== timer);
        reject(new Error(`timeout waiting for ${type}`));
      }, timeout);
      this.waiters.push({ type, resolve, timer });
    });
  }

  report(partial: Record<string, unknown>): void {
    this.send({
      type: "player.state",
      report: { deviceId: DEVICE, status: "playing", trackId: null, position: 0, volume: 100, queueIndex: 0, updatedAt: Date.now(), ...partial },
    });
  }

  close(): void {
    this.ws.close();
  }
}

function track(id: string): Track {
  return { id, provider: "youtube-music", title: `E2E ${id}`, artist: "QA", duration: 200 };
}

async function api(method: string, url: string, body?: unknown) {
  return app.inject({
    method: method as "GET" | "POST" | "PUT" | "DELETE",
    url,
    headers: { authorization: `Bearer ${controllerToken}` },
    payload: body,
  });
}

beforeAll(async () => {
  await connectRedis();
  await prisma.user.upsert({
    where: { id: USER },
    update: { passwordHash: hashPassword("e2epass123") },
    create: { id: USER, username: "e2etest", passwordHash: hashPassword("e2epass123"), role: "admin" },
  });
  await prisma.device.upsert({
    where: { id: DEVICE },
    update: { userId: null, name: "QA E2E", tokenHash: sha256(DEV_TOKEN) },
    create: { id: DEVICE, name: "QA E2E", type: "qa", tokenHash: sha256(DEV_TOKEN) },
  });
  for (const [id, tok] of [
    [DEVICE_B, DEV_TOKEN_B],
    [DEVICE_C, DEV_TOKEN_C],
  ] as const) {
    await prisma.device.upsert({
      where: { id },
      update: { userId: null, name: `QA E2E ${id}`, tokenHash: sha256(tok) },
      create: { id, name: `QA E2E ${id}`, type: "qa", tokenHash: sha256(tok) },
    });
  }
  app = await buildApp();
  await app.listen({ port: 0, host: "127.0.0.1" });
  port = (app.server.address() as AddressInfo).port;
  const login = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { username: "e2etest", password: "e2epass123" },
  });
  controllerToken = JSON.parse(login.body).token as string;
  // deterministic baseline: stored volume 100 (Redis persists across runs).
  // set directly via the service — the HTTP route requires an online player.
  await deviceService.setVolume(DEVICE, 100);
});

afterAll(async () => {
  await prisma.device.deleteMany({ where: { id: { in: [DEVICE, DEVICE_B, DEVICE_C] } } }).catch(() => null);
  await prisma.user.deleteMany({ where: { id: USER } }).catch(() => null);
  await app.close();
  redis.disconnect(); // synchronous — no unhandled rejections from late WS handlers
  await prisma.$disconnect();
});

const url = () => `ws://127.0.0.1:${port}/ws/player`;

describe("player WebSocket auth", () => {
  it("auth success → player.ready + stored volume sync", async () => {
    const p = new FakePlayer(url());
    await p.opened;
    await p.auth(DEVICE, DEV_TOKEN);
    await p.next("player.ready");
    const vol = await p.next("player.setVolume");
    expect((vol as { volume: number }).volume).toBe(100);
    p.close();
  });

  it("wrong token → closed 4401", async () => {
    const p = new FakePlayer(url());
    await p.opened;
    await p.auth(DEVICE, "wrong-token");
    expect(await p.closed).toBe(4401);
  });

  it("auth-first enforcement → closed 4401", async () => {
    const p = new FakePlayer(url());
    await p.opened;
    p.send({ type: "player.heartbeat" }); // command before auth
    expect(await p.closed).toBe(4401);
  });

  it("malformed JSON → closed 4400 without crashing the gateway", async () => {
    const p = new FakePlayer(url());
    await p.opened;
    (p as unknown as { ws: WebSocket }).ws.send("{not-json");
    expect(await p.closed).toBe(4400);
  });
});

describe("controller → player command flow", () => {
  it("play sends player.load; state converges via report", async () => {
    const p = new FakePlayer(url());
    await p.opened;
    await p.auth(DEVICE, DEV_TOKEN);
    await p.next("player.ready");
    await p.next("player.setVolume");

    const play = await api("POST", `/api/devices/${DEVICE}/play`, { trackId: "E2E1", track: track("E2E1") });
    expect(play.statusCode).toBe(200);

    const load = (await p.next("player.load")) as { trackId: string; media: { mode: string } };
    expect(load.trackId).toBe("E2E1");
    expect(load.media.mode).toBe("id");
    p.report({ trackId: "E2E1", status: "playing", position: 5 });

    await new Promise((r) => setTimeout(r, 500)); // let the report land
    const st = await api("GET", `/api/devices/${DEVICE}/state`);
    const state = JSON.parse(st.body).state;
    expect(state.track.id).toBe("E2E1");
    expect(state.state).toBe("playing"); // PlaybackState.state = status
    expect(state.position).toBe(5);
    p.close();
  });

  it("pause / resume / seek / volume commands reach the player", async () => {
    const p = new FakePlayer(url());
    await p.opened;
    await p.auth(DEVICE, DEV_TOKEN);
    await p.next("player.ready");
    await p.next("player.setVolume");

    await api("POST", `/api/devices/${DEVICE}/play`, { trackId: "E2E2", track: track("E2E2") });
    await p.next("player.load");

    await api("POST", `/api/devices/${DEVICE}/pause`);
    expect((await p.next("player.pause")).type).toBe("player.pause");
    p.report({ trackId: "E2E2", status: "paused", position: 10 });

    await api("POST", `/api/devices/${DEVICE}/resume`);
    expect((await p.next("player.resume")).type).toBe("player.resume");

    await api("POST", `/api/devices/${DEVICE}/seek`, { position: 42 });
    const seek = (await p.next("player.seek")) as { position: number };
    expect(seek.position).toBe(42);

    await api("POST", `/api/devices/${DEVICE}/volume`, { volume: 60 });
    const vol = (await p.next("player.setVolume")) as { volume: number };
    expect(vol.volume).toBe(60);
    p.close();
  });

  it("trackEnded triggers auto-next with the following queue item", async () => {
    const p = new FakePlayer(url());
    await p.opened;
    await p.auth(DEVICE, DEV_TOKEN);
    await p.next("player.ready");
    await p.next("player.setVolume");

    await api("POST", `/api/devices/${DEVICE}/queue`, { track: track("A1") });
    await api("POST", `/api/devices/${DEVICE}/queue`, { track: track("A2") });
    await api("POST", `/api/devices/${DEVICE}/play`, { trackId: "A1", track: track("A1") });
    await p.next("player.load");
    p.report({ trackId: "A1", status: "playing", position: 0, queueIndex: 0 });

    // anti-loop guard: trackEnded within 3s of a load is ignored (stale eof)
    await new Promise((r) => setTimeout(r, 3200));
    p.send({ type: "player.trackEnded", deviceId: DEVICE });
    const nextLoad = (await p.next("player.load")) as { trackId: string };
    expect(nextLoad.trackId).toBe("A2");
    p.close();
  });
});

describe("player registry / reconnect", () => {
  it("device is offline while disconnected, online after reconnect", async () => {
    const p = new FakePlayer(url());
    await p.opened;
    await p.auth(DEVICE, DEV_TOKEN);
    await p.next("player.ready");
    await new Promise((r) => setTimeout(r, 100));
    expect((await deviceService.list()).find((d) => d.id === DEVICE)?.online).toBe(true);
    p.close();
    await new Promise((r) => setTimeout(r, 150));
    expect((await deviceService.list()).find((d) => d.id === DEVICE)?.online).toBe(false);
  });

  it("old socket close cannot evict the newer connection (registry race)", async () => {
    const a = new FakePlayer(url());
    await a.opened;
    await a.auth(DEVICE, DEV_TOKEN);
    await a.next("player.ready");
    const b = new FakePlayer(url());
    await b.opened;
    await b.auth(DEVICE, DEV_TOKEN);
    await b.next("player.ready");

    a.close(); // stale socket dies AFTER b registered
    await a.closed;
    await new Promise((r) => setTimeout(r, 150));
    // b must still own the registry entry → online stays true
    expect((await deviceService.list()).find((d) => d.id === DEVICE)?.online).toBe(true);
    b.close();
  });
});

describe("handoff (device transfer)", () => {
  it("transfers the current track + position to an online device", async () => {
    const a = new FakePlayer(url());
    await a.opened;
    await a.auth(DEVICE, DEV_TOKEN);
    await a.next("player.ready");
    await a.next("player.setVolume");
    const b = new FakePlayer(url());
    await b.opened;
    await b.auth(DEVICE_B, DEV_TOKEN_B);
    await b.next("player.ready");
    await b.next("player.setVolume");

    // play on A, report position 77
    await api("POST", `/api/devices/${DEVICE}/play`, { trackId: "H1", track: track("H1") });
    await a.next("player.load");
    a.report({ trackId: "H1", status: "playing", position: 77, queueIndex: 0 });
    await new Promise((r) => setTimeout(r, 300));

    const tr = await api("POST", `/api/devices/${DEVICE}/transfer`, { to: DEVICE_B });
    expect(tr.statusCode).toBe(200);

    // B gets load with the carried position + play; A gets stop
    const bLoad = (await b.next("player.load")) as { trackId: string; position: number };
    expect(bLoad.trackId).toBe("H1");
    expect(bLoad.position).toBeCloseTo(77, 0);
    await b.next("player.play");
    await a.next("player.stop");

    await new Promise((r) => setTimeout(r, 300));
    const stB = JSON.parse((await api("GET", `/api/devices/${DEVICE_B}/state`)).body).state;
    expect(stB.track?.id).toBe("H1");
    expect(stB.state).toBe("playing");
    const stA = JSON.parse((await api("GET", `/api/devices/${DEVICE}/state`)).body).state;
    expect(stA.state).toBe("stopped");
    a.close();
    b.close();
  });

  it("transfer to an offline device is rejected (source keeps playing)", async () => {
    const a = new FakePlayer(url());
    await a.opened;
    await a.auth(DEVICE, DEV_TOKEN);
    await a.next("player.ready");
    await a.next("player.setVolume");
    await api("POST", `/api/devices/${DEVICE}/play`, { trackId: "H2", track: track("H2") });
    await a.next("player.load");
    a.report({ trackId: "H2", status: "playing", position: 10, queueIndex: 0 });
    await new Promise((r) => setTimeout(r, 300));

    // DEVICE_C never connects → PLAYER_OFFLINE, source untouched
    const res = await api("POST", `/api/devices/${DEVICE}/transfer`, { to: DEVICE_C });
    expect(res.statusCode).toBe(409);

    await new Promise((r) => setTimeout(r, 200));
    const stA = JSON.parse((await api("GET", `/api/devices/${DEVICE}/state`)).body).state;
    expect(stA.track?.id).toBe("H2");
    expect(stA.state).toBe("playing");
    a.close();
  });
});

describe("metrics", () => {
  it("GET /metrics is public and exposes Prometheus text", async () => {
    const res = await app.inject({ method: "GET", url: "/metrics" }); // no auth
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/plain");
    const body = res.body;
    expect(body).toContain("# TYPE music_ws_connections_total counter");
    expect(body).toMatch(/music_active_players \d+/);
  });
});
