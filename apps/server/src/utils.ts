import { createHash } from "node:crypto";

/** Device tokens are stored hashed (PRD §30) — never in plaintext. */
export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * Accepts a YT Music playlist URL or a bare playlist id:
 *   https://music.youtube.com/playlist?list=PL...&si=...
 *   https://www.youtube.com/watch?v=...&list=PL...
 *   PL... / VLPL... / RD... / OLAK5uy_...
 */
export function extractPlaylistId(input: string): string | null {
  const trimmed = input.trim();
  if (/^[A-Za-z0-9_-]{13,}$/.test(trimmed)) return trimmed;
  try {
    const url = new URL(trimmed);
    const list = url.searchParams.get("list");
    return list && /^[A-Za-z0-9_-]{13,}$/.test(list) ? list : null;
  } catch {
    return null;
  }
}
