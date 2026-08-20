import type { PlayerCommand } from "@music-connect/protocol";
import type { Mpv } from "./mpv.js";
import type { PlayerState } from "./state.js";
import { mediaToMpvUrl, resolveStreamUrl } from "./resolver.js";

export type CommandHandler = (cmd: PlayerCommand) => Promise<void>;

/** Maps server commands (PRD §22) to mpv calls. */
export function makeCommandHandler(mpv: Mpv, state: PlayerState): CommandHandler {
  return async (cmd) => {
    switch (cmd.type) {
      case "player.load": {
        // resolve-first: get a real stream URL via yt-dlp, then hand mpv a
        // plain URL (no mpv-internal yt-dlp integration that can stall).
        // Resolve failures throw → the caller reports trackEnded error.
        const url = cmd.media.mode === "url" ? cmd.media.url : await resolveStreamUrl(cmd.media.youtubeId);
        state.setTrack(cmd.trackId, cmd.media);
        state.clearPrefetched(); // a fresh load invalidates any appended entry
        await mpv.load(url, cmd.position);
        if (cmd.volume !== undefined) await mpv.setVolume(cmd.volume);
        break;
      }
      case "player.play":
        state.status = "playing";
        await mpv.play();
        break;
      case "player.pause":
        state.status = "paused";
        await mpv.pause();
        break;
      case "player.resume":
        state.status = "playing";
        await mpv.play();
        break;
      case "player.seek":
        state.position = cmd.position;
        await mpv.seek(cmd.position);
        break;
      case "player.setVolume":
        state.volume = cmd.volume;
        await mpv.setVolume(cmd.volume);
        break;
      case "player.stop":
        state.status = "stopped";
        state.clearPrefetched();
        await mpv.stop();
        break;
      case "player.prefetch": {
        // gapless v2: resolve the NEXT track's URL NOW (not when it starts),
        // append it to mpv's playlist — mpv switches to it seamlessly at eof.
        // Best-effort: a resolve failure must not disturb the current track.
        try {
          const url = cmd.media.mode === "url" ? cmd.media.url : await resolveStreamUrl(cmd.media.youtubeId);
          await mpv.appendPrefetch(url);
          state.prefetchedTrackId = cmd.trackId;
        } catch (e) {
          console.error("[player] prefetch resolve failed — skipping:", e instanceof Error ? e.message : e);
        }
        break;
      }
      case "player.prefetchClear":
        // cancel a stale prefetch (queue changed / user skipped) — the
        // currently playing entry is kept, the rest of the playlist drops
        state.clearPrefetched();
        await mpv.clearPlaylist();
        break;
    }
  };
}
