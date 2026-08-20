import { spawn, type ChildProcess } from "node:child_process";
import { createConnection, type Socket } from "node:net";
import { unlinkSync } from "node:fs";
import { EventEmitter } from "node:events";

export interface MpvState {
  paused: boolean;
  position: number; // seconds
  duration: number;
  volume: number;
  idle: boolean;
}

/** Duration of a full-range volume transition (smooth, no jump). */
const VOLUME_RAMP_MS = Number(process.env.VOLUME_RAMP_MS ?? 900);

/**
 * Pure ramp plan (exported for tests): step size/duration for a smooth
 * volume transition. Returns null when no ramp is needed (already there).
 */
export function volumeRampPlan(
  current: number,
  target: number,
  rampMs: number,
): { steps: number; stepMs: number; delta: number } | null {
  const clamped = Math.max(0, Math.min(130, Math.round(target)));
  const diff = clamped - current;
  if (Math.abs(diff) < 1 || rampMs <= 0) return null;
  // 2% per step → ramp duration ≈ rampMs regardless of distance
  const steps = Math.max(2, Math.min(60, Math.round(Math.abs(diff) / 2)));
  const stepMs = Math.max(25, Math.round(rampMs / steps));
  return { steps, stepMs, delta: diff / steps };
}

interface PendingCommand {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

/**
 * mpv controller over JSON IPC (PRD §11-§12).
 * mpv is spawned with --input-ipc-server and driven via the socket.
 * The IPC socket stays local and is never exposed (PRD §30).
 */
export class Mpv extends EventEmitter {
  private proc: ChildProcess | null = null;
  private sock: Socket | null = null;
  private buf = "";
  private nextId = 1;
  private pending = new Map<number, PendingCommand>();
  private readonly isTcp: boolean;
  private readonly host: string;
  private readonly port: number;
  // 6.1: lifecycle guard — exactly one mpv process, one IPC connection and
  // one restart timer; shutdown must not trigger the crash-restart path.
  private started = false;
  private stopping = false;
  private restartTimer: NodeJS.Timeout | null = null;
  // 15: one active IPC connection attempt + one reconnect timer max
  private ipcConnecting = false;
  private ipcRetryTimer: NodeJS.Timeout | null = null;

  state: MpvState = { paused: false, position: 0, duration: 0, volume: 70, idle: true };

  constructor(ipcEndpoint: string) {
    super();
    // many commands may wait on the IPC socket at once (slow device boot)
    this.setMaxListeners(50);
    // endpoint: "host:port" (TCP loopback, default — reliable on Termux) or
    // a filesystem path (unix socket) when MPV_IPC is set to one
    const tcp = ipcEndpoint.match(/^([^:/]+):(\d+)$/);
    if (tcp) {
      this.isTcp = true;
      this.host = tcp[1] ?? ipcEndpoint;
      this.port = Number(tcp[2]);
    } else {
      this.isTcp = false;
      this.host = ipcEndpoint;
      this.port = 0;
    }
  }

  private get ipcArg(): string {
    return this.isTcp ? `--input-ipc-server=${this.host}:${this.port}` : `--input-ipc-server=${this.host}`;
  }

  start(): void {
    if (this.started || this.stopping) return; // 6.1: single-process guarantee
    this.started = true;
    // MPV_BIN lets unusual environments (Termux, portable builds) point at mpv
    const bin = process.env.MPV_BIN ?? "mpv";
    if (!this.isTcp) {
      // a stale socket file from a previous run would make mpv fail to bind
      try {
        unlinkSync(this.host);
      } catch {
        // no stale socket — fine
      }
    }
    this.proc = spawn(
      bin,
      [
        "--no-video",
        "--idle=yes",
        // audio-only: yt-dlp picks the best audio stream only (no video track) —
        // much less bandwidth, faster start (YouTube Music: opus ~130kbps)
        "--ytdl-format=bestaudio/best",
        this.ipcArg,
      ],
      {
        stdio: ["ignore", "ignore", "pipe"],
      },
    );
    this.proc.stderr?.on("data", (d: Buffer) => this.emit("stderr", d.toString()));
    this.proc.on("error", (err) => {
      // spawn failure (e.g. mpv binary missing) — give a clear hint
      this.emit("error", err);
      console.error("[player] mpv FAILED TO START:", err.message, "— is mpv installed and on PATH?");
    });
    this.proc.on("exit", (code) => {
      this.emit("exit", code);
      this.sock?.destroy();
      this.sock = null;
      this.started = false;
      if (this.stopping) return; // graceful shutdown — do not respawn
      console.error(`[player] mpv exited (code ${code}) — restarting in 2s`);
      // mpv may crash on first audio init (common on Android/Termux) — respawn
      this.restartTimer = setTimeout(() => this.start(), 2000);
    });
    this.connectWithRetry();
  }

  /** 6.2: tear mpv down for shutdown — no respawn, no reconnect. */
  shutdown(): void {
    if (this.stopping) return;
    this.stopping = true;
    if (this.restartTimer) clearTimeout(this.restartTimer);
    if (this.ipcRetryTimer) {
      clearTimeout(this.ipcRetryTimer);
      this.ipcRetryTimer = null;
    }
    if (this.rampTimer) {
      clearTimeout(this.rampTimer);
      this.rampTimer = null;
    }
    if (this.sock) {
      this.sock.destroy();
      this.sock = null;
    }
    if (this.proc) {
      this.proc.kill("SIGTERM");
      this.proc = null;
    }
  }

  get isStopping(): boolean {
    return this.stopping;
  }

  private connectWithRetry(): void {
    if (this.stopping || this.ipcConnecting) return; // one attempt at a time
    this.ipcConnecting = true;
    const sock = this.isTcp
      ? createConnection({ host: this.host, port: this.port })
      : createConnection(this.host);
    sock.on("connect", () => {
      this.ipcConnecting = false;
      this.sock = sock;
      this.buf = "";
      this.attach(sock);
      void this.observeProperties().catch(() => {
        // property observation is best-effort — never crash on it
      });
      console.log("[player] mpv IPC connected");
      this.emit("connected");
    });
    sock.on("error", () => {
      // mpv may take a while to create the IPC socket (slow devices like
      // Termux) — keep retrying forever; the socket can appear any time
      this.ipcConnecting = false;
      this.scheduleIpcReconnect();
    });
  }

  /** 15: exactly ONE reconnect timer and ONE connection attempt — error and
   *  close both fire on a dead socket and must not double-schedule. */
  private scheduleIpcReconnect(): void {
    if (this.stopping || this.ipcRetryTimer) return;
    this.ipcRetryTimer = setTimeout(() => {
      this.ipcRetryTimer = null;
      this.connectWithRetry();
    }, 1000);
    this.ipcRetryTimer.unref?.();
  }

  private attach(sock: Socket): void {
    sock.on("data", (chunk: Buffer) => {
      this.buf += chunk.toString("utf8");
      let idx = this.buf.indexOf("\n");
      while (idx >= 0) {
        const line = this.buf.slice(0, idx);
        this.buf = this.buf.slice(idx + 1);
        if (line.trim()) {
          try {
            this.handleMessage(JSON.parse(line) as Record<string, unknown>);
          } catch {
            // ignore malformed line
          }
        }
        idx = this.buf.indexOf("\n");
      }
    });
    sock.on("close", () => {
      this.sock = null;
      this.ipcConnecting = false;
      for (const p of this.pending.values()) {
        clearTimeout(p.timer);
        p.reject(new Error("mpv disconnected"));
      }
      this.pending.clear();
      this.scheduleIpcReconnect();
    });
  }

  private handleMessage(msg: Record<string, unknown>): void {
    if (typeof msg.request_id === "number") {
      const p = this.pending.get(msg.request_id);
      if (p) {
        this.pending.delete(msg.request_id);
        clearTimeout(p.timer);
        if (msg.error === "success") p.resolve(msg.data);
        else p.reject(new Error(`mpv error: ${String(msg.error)}`));
      }
      return;
    }
    if (msg.event === "property-change") {
      const name = String(msg.name);
      if (name === "pause") this.state.paused = msg.data === true;
      if (name === "time-pos") this.state.position = typeof msg.data === "number" ? msg.data : this.state.position;
      if (name === "duration") this.state.duration = typeof msg.data === "number" ? msg.data : this.state.duration;
      if (name === "volume") this.state.volume = typeof msg.data === "number" ? msg.data : this.state.volume;
      if (name === "idle-active") this.state.idle = msg.data === true;
      this.emit("state", this.state);
      return;
    }
    if (msg.event === "end-file") {
      this.state.idle = true;
      this.emit("end-file", msg.reason);
    }
  }

  private async observeProperties(): Promise<void> {
    const props = ["pause", "time-pos", "duration", "volume", "idle-active"];
    for (const p of props) {
      await this.command(["observe_property", p]).catch(() => null);
    }
  }

  /** Resolve once the mpv IPC socket is ready (mpv may take a moment to boot). */
  private waitConnected(timeoutMs = 30000): Promise<void> {
    if (this.sock) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const onConnected = (): void => {
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => {
        this.off("connected", onConnected);
        reject(new Error("mpv not connected"));
      }, timeoutMs);
      timer.unref();
      this.once("connected", onConnected);
    });
  }

  command(cmd: (string | number | boolean)[]): Promise<unknown> {
    return this.waitConnected().then(
      () =>
        new Promise((resolve, reject) => {
          if (!this.sock) {
            reject(new Error("mpv not connected"));
            return;
          }
          const id = this.nextId++;
          const timer = setTimeout(() => {
            this.pending.delete(id);
            reject(new Error(`mpv command timeout: ${String(cmd[0])}`));
          }, 5000);
          timer.unref();
          this.pending.set(id, { resolve, reject, timer });
          this.sock.write(JSON.stringify({ command: cmd, request_id: id }) + "\n");
        }),
    );
  }

  async load(url: string, position?: number): Promise<void> {
    // playlist-clear first: any prefetched entry (player.prefetch) is now stale
    // — the server just decided to play something else (skip/seek/other track)
    await this.command(["playlist-clear"]).catch(() => null);
    // position rides along with loadfile (start=N, absolute) — atomic, no seek
    // race; falls back to plain load + seek when options are rejected
    const pos = position && position > 0 ? Math.floor(position) : 0;
    let lastErr: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        if (pos > 0) {
          try {
            await this.command(["loadfile", url, "replace", `start=${pos}`]);
          } catch {
            // older/Android mpv may reject loadfile options — load + seek instead
            await this.command(["loadfile", url, "replace"]);
            await this.waitForPlayback();
            await this.command(["seek", pos, "absolute"]).catch(() => null);
          }
        } else {
          await this.command(["loadfile", url, "replace"]);
        }
        lastErr = undefined;
        break;
      } catch (e) {
        lastErr = e;
        await new Promise((r) => setTimeout(r, 1200));
      }
    }
    if (lastErr) throw lastErr as Error;
    this.state.idle = false;
  }

  /** Resolve once playback actually started (time-pos > 0) — demuxer is ready. */
  private async waitForPlayback(timeoutMs = 15000): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const p = await this.command(["get_property", "time-pos"]).catch(() => null);
      if (typeof p === "number" && p > 0) return;
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  async play(): Promise<void> {
    await this.command(["set_property", "pause", false]);
  }

  async pause(): Promise<void> {
    await this.command(["set_property", "pause", true]);
  }

  async seek(position: number): Promise<void> {
    await this.command(["seek", position, "absolute"]);
  }

  /** Gapless: append the upcoming track to the playlist (mpv plays it
   *  automatically once the current entry ends). Best-effort — if the
   *  player/device chokes on playlist prefetching, the server can opt out
   *  (PREFETCH_ENABLED=false) and this becomes a no-op. */
  async appendPrefetch(url: string): Promise<void> {
    if (process.env.PREFETCH_ENABLED === "false") return;
    await this.command(["loadfile", url, "append"]).catch(() => null);
  }

  /** Cancel a pending prefetch (queue changed / user skipped). mpv keeps the
   *  currently playing entry and drops the rest of the playlist. */
  async clearPlaylist(): Promise<void> {
    await this.command(["playlist-clear"]).catch(() => null);
  }

  async setVolume(volume: number): Promise<void> {
    this.state.volume = volume;
    await this.command(["set_property", "volume", volume]);
  }

  async getVolume(): Promise<number> {
    const d = await this.command(["get_property", "volume"]).catch(() => null);
    return typeof d === "number" ? d : this.state.volume;
  }

  // Smooth volume: ramp from the current value to the target instead of a
  // hard jump. A new target (slider drag, load sync) restarts from wherever
  // the ramp is right now — never fights the previous ramp.
  private rampTimer: NodeJS.Timeout | null = null;

  async setVolumeSmooth(target: number, rampMs = VOLUME_RAMP_MS): Promise<void> {
    if (this.rampTimer) {
      clearTimeout(this.rampTimer);
      this.rampTimer = null;
    }
    const clamped = Math.max(0, Math.min(130, Math.round(target)));
    const current = Number(await this.getVolume().catch(() => this.state.volume));
    const plan = volumeRampPlan(current, clamped, rampMs);
    if (!plan) {
      this.state.volume = clamped;
      await this.command(["set_property", "volume", clamped]).catch(() => null);
      return;
    }
    const { steps, stepMs, delta } = plan;
    let pos = current;
    const tick = (): void => {
      this.rampTimer = null;
      pos += delta;
      const done = Math.abs(pos - clamped) <= Math.abs(delta) / 2;
      const value = done ? clamped : Math.round(pos);
      this.state.volume = value;
      void this.command(["set_property", "volume", value]).catch(() => null);
      if (!done) {
        this.rampTimer = setTimeout(tick, stepMs);
        this.rampTimer.unref?.();
      }
    };
    tick();
  }

  async stop(): Promise<void> {
    if (this.rampTimer) {
      clearTimeout(this.rampTimer);
      this.rampTimer = null;
    }
    await this.command(["stop"]).catch(() => null);
    this.state.idle = true;
    this.state.position = 0;
  }

  async getTimePos(): Promise<number> {
    const d = await this.command(["get_property", "time-pos"]);
    return typeof d === "number" ? d : this.state.position;
  }

  /** Query duration directly — observe_property events aren't reliable on some platforms. */
  async getDuration(): Promise<number> {
    const d = await this.command(["get_property", "duration"]);
    return typeof d === "number" ? d : this.state.duration;
  }
}
