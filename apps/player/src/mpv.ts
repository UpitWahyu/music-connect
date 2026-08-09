import { spawn, type ChildProcess } from "node:child_process";
import { createConnection, type Socket } from "node:net";
import { EventEmitter } from "node:events";

export interface MpvState {
  paused: boolean;
  position: number; // seconds
  duration: number;
  volume: number;
  idle: boolean;
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

  state: MpvState = { paused: false, position: 0, duration: 0, volume: 70, idle: true };

  constructor(private readonly socketPath: string) {
    super();
  }

  start(): void {
    this.proc = spawn("mpv", ["--no-video", "--idle=yes", `--input-ipc-server=${this.socketPath}`], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    this.proc.stderr?.on("data", (d: Buffer) => this.emit("stderr", d.toString()));
    this.proc.on("error", (err) => this.emit("error", err));
    this.proc.on("exit", (code) => {
      this.emit("exit", code);
      this.sock?.destroy();
      this.sock = null;
    });
    this.connectWithRetry();
  }

  private connectWithRetry(attempt = 0): void {
    const sock = createConnection(this.socketPath);
    sock.on("connect", () => {
      this.sock = sock;
      this.buf = "";
      this.attach(sock);
      void this.observeProperties().catch(() => {
        // property observation is best-effort — never crash on it
      });
      this.emit("connected");
    });
    sock.on("error", () => {
      // mpv may take a moment to create the IPC socket — keep retrying
      if (attempt < 40) setTimeout(() => this.connectWithRetry(attempt + 1), 500);
    });
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
      for (const p of this.pending.values()) {
        clearTimeout(p.timer);
        p.reject(new Error("mpv disconnected"));
      }
      this.pending.clear();
      this.connectWithRetry();
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
  private waitConnected(timeoutMs = 15000): Promise<void> {
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
    await this.command(["loadfile", url, "replace"]);
    if (position && position > 0) await this.command(["seek", position, "absolute"]);
    this.state.idle = false;
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

  async setVolume(volume: number): Promise<void> {
    this.state.volume = volume;
    await this.command(["set_property", "volume", volume]);
  }

  async stop(): Promise<void> {
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
