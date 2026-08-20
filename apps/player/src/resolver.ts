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

/** In-session cache: the same track is usually prefetched then played. */
const urlCache = new Map<string, string>();

export function mediaToMpvUrl(media: MediaRef): string {
  if (media.mode === "url") return media.url;
  return `https://music.youtube.com/watch?v=${encodeURIComponent(media.youtubeId)}`;
}

/** Resolve a playable audio URL for a track id (yt-dlp --get-url). */
export async function resolveStreamUrl(youtubeId: string): Promise<string> {
  const cached = urlCache.get(youtubeId);
  if (cached) return cached;
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
  urlCache.set(youtubeId, url);
  return url;
}
