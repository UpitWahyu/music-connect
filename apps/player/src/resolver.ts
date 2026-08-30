import { execFile } from "node:child_process";
import type { MediaRef } from "@music-connect/protocol";

/**
 * Dual-mode media resolution (PRD §41 D-01).
 *
 * mode "url" → pass the server-provided stream URL straight through
 *              (future: native Android / ExoPlayer).
 * mode "id"  → resolve a real stream URL FIRST via yt-dlp, then hand mpv the
 *              plain URL. mpv no longer needs its internal yt-dlp integration
 *              (which silently stalled on some versions/platforms), the
 *              resolve is explicit, retryable and logged. This is the
 *              "resolve first, then play" approach chosen for stability.
 */
const YTDLP_BIN = process.env.YTDLP_BIN ?? "yt-dlp";
const RESOLVE_TIMEOUT_MS = Number(process.env.RESOLVE_TIMEOUT_MS ?? 20000);

/** In-session cache: the same track is usually prefetched then played.
 *  P1 #15: stream URLs are short-lived — cache with a TTL (default 5 min) so a
 *  stale URL from an old resolution can't make mpv fail against an expired
 *  googlevideo signature. */
const URL_TTL_MS = Number(process.env.STREAM_URL_TTL_MS ?? 5 * 60 * 1000);
const urlCache = new Map<string, { url: string; expires: number }>();

export function mediaToMpvUrl(media: MediaRef): string {
  if (media.mode === "url") return media.url;
  return `https://music.youtube.com/watch?v=${encodeURIComponent(media.youtubeId)}`;
}

// P1 #14: bound how many yt-dlp processes run at once — a burst of resolves
// (e.g. prefetch + play + auto-queue on a slow Pi/Termux) must not fork dozens
// of external processes. A simple semaphore with a small queue.
const MAX_YTDLP_CONCURRENCY = Number(process.env.MAX_YTDLP_CONCURRENCY ?? 2);
let activeResolves = 0;
const resolveQueue: Array<() => void> = [];

function acquireResolveSlot(): Promise<void> {
  if (activeResolves < MAX_YTDLP_CONCURRENCY) {
    activeResolves++;
    return Promise.resolve();
  }
  return new Promise((resolve) => resolveQueue.push(resolve));
}

function releaseResolveSlot(): void {
  if (resolveQueue.length > 0) {
    const next = resolveQueue.shift();
    next?.();
  } else {
    activeResolves--;
  }
}

/** Resolve a playable audio URL for a track id (yt-dlp --get-url). */
export async function resolveStreamUrl(youtubeId: string): Promise<string> {
  const cached = urlCache.get(youtubeId);
  if (cached && cached.expires > Date.now()) return cached.url;
  await acquireResolveSlot();
  try {
    const url = await new Promise<string>((resolve, reject) => {
      execFile(
        YTDLP_BIN,
        ["--no-warnings", "--get-url", "-f", "bestaudio/best", mediaToMpvUrl({ mode: "id", youtubeId })],
        { timeout: RESOLVE_TIMEOUT_MS, maxBuffer: 2 * 1024 * 1024 },
        (err, stdout) => {
          if (err) return reject(err);
          const line = stdout.trim().split("\n")[0];
          if (!line) return reject(new Error("yt-dlp returned no URL"));
          resolve(line);
        },
      );
    });
    urlCache.set(youtubeId, { url, expires: Date.now() + URL_TTL_MS });
    return url;
  } finally {
    releaseResolveSlot();
  }
}
