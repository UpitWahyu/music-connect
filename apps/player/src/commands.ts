import type { PlayerCommand } from "@music-connect/protocol";
import type { Mpv } from "./mpv.js";
import type { PlayerState } from "./state.js";
import { mediaToMpvUrl } from "./resolver.js";

export type CommandHandler = (cmd: PlayerCommand) => Promise<void>;

/** Maps server commands (PRD §22) to mpv calls. */
export function makeCommandHandler(mpv: Mpv, state: PlayerState): CommandHandler {
  return async (cmd) => {
    switch (cmd.type) {
      case "player.load":
        state.setTrack(cmd.trackId, cmd.media);
        await mpv.load(mediaToMpvUrl(cmd.media), cmd.position);
        if (cmd.volume !== undefined) await mpv.setVolume(cmd.volume);
        break;
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
        await mpv.stop();
        break;
    }
  };
}
