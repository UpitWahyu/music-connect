import type { MediaRef } from "@music-connect/protocol";

/**
 * Dual-mode media resolution (PRD §41 D-01).
 *
 * mode "id"  → build a watch URL; mpv + yt-dlp resolves and streams directly
 *              from YouTube (V1: desktop & Termux).
 * mode "url" → pass a server-provided stream URL straight through (future:
 *              native Android / ExoPlayer).
 */
export function mediaToMpvUrl(media: MediaRef): string {
  if (media.mode === "url") return media.url;
  return `https://music.youtube.com/watch?v=${encodeURIComponent(media.youtubeId)}`;
}
