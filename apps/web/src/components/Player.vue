<script setup lang="ts">
import { computed, ref, watch } from "vue";
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Shuffle,
  Repeat,
  Repeat1,
  Volume2,
  VolumeX,
  Power,
  MoreHorizontal,
  Heart,
  FolderPlus,
} from "lucide-vue-next";
import { api } from "../lib/api";
import { store, sendWsCommand, refreshState, refreshDevices, refreshFavorites, refreshPlaylists } from "../composables/useMusic";
import { showToast } from "../composables/useToast";
import { t, i18n } from "../i18n";
import { formatDuration } from "../lib/format";
import DeviceSelector from "./DeviceSelector.vue";

const pb = computed(() => store.playback);
const isPlaying = computed(() => pb.value?.state === "playing");
const track = computed(() => pb.value?.track ?? null);
const thisDevice = computed(() => store.devices.find((d) => d.id === store.selectedDevice) ?? null);
/** Another online device currently able to play (for offline-selection hints). */
const activeOtherDevice = computed(
  () => store.devices.find((d) => d.id !== store.selectedDevice && d.online) ?? null,
);
const progressPct = computed(() => {
  const d = track.value?.duration ?? 0;
  return d > 0 ? Math.min(100, ((pb.value?.position ?? 0) / d) * 100) : 0;
});

// --- seek slider (Spotify style): preview while dragging, ONE command on release ---
const seekLocal = ref(0);
const seekDragging = ref(false);
const trackDuration = computed(() => track.value?.duration ?? 0);
const seekDisplay = computed(() => (seekDragging.value ? seekLocal.value : pb.value?.position ?? 0));

/** Green played portion + faint track, like the old progress line. */
const seekPct = computed(() => {
  const d = trackDuration.value;
  const pos = seekDisplay.value;
  return d > 0 ? Math.min(100, (pos / d) * 100) : 0;
});
const seekBarStyle = computed(() => ({
  background: `linear-gradient(to right, #22c55e ${seekPct.value}%, rgba(255,255,255,0.1) ${seekPct.value}%)`,
}));

function onSeekStart(): void {
  seekDragging.value = true;
  seekLocal.value = pb.value?.position ?? 0;
}

function onSeekInput(e: Event): void {
  // drag preview only — nothing is sent to the server while dragging
  seekDragging.value = true;
  seekLocal.value = Number((e.target as HTMLInputElement).value);
}

function onSeekCommit(e: Event): void {
  // fired on release: exactly one seek command per drag (no WS/mpv spam)
  const pos = Number((e.target as HTMLInputElement).value);
  seekDragging.value = false;
  seekLocal.value = pos;
  if (!store.selectedDevice) return;
  if (store.playback) store.playback.position = pos; // optimistic — push confirms
  const sent = sendWsCommand({ type: "seek", deviceId: store.selectedDevice, position: pos });
  if (!sent) void cmd(() => api.seek(store.selectedDevice!, pos));
}

const showDetail = ref(false);
const macInput = ref("");
const wakeMsg = ref("");

// Volume: local ref for instant slider feedback, WS command throttled to
// 250ms (falls back to REST when the WS is not open yet).
const volumeLocal = ref(70);
let volumeTimer: ReturnType<typeof setTimeout> | null = null;
let lastVolumeSent = 0;
let lastVolume = 70;

/** Mute toggle: remembers the pre-mute level and restores it on unmute. */
function toggleMute(): void {
  if (!store.selectedDevice) return;
  const target = volumeLocal.value > 0 ? 0 : lastVolume > 0 ? lastVolume : 70;
  if (volumeLocal.value > 0) lastVolume = volumeLocal.value;
  volumeLocal.value = target;
  const sent = sendWsCommand({ type: "setVolume", deviceId: store.selectedDevice, volume: target });
  if (!sent) void cmd(() => api.volume(store.selectedDevice!, target));
}

watch(
  () => pb.value?.volume,
  (v) => {
    if (v !== undefined && Math.abs(v - volumeLocal.value) > 3) volumeLocal.value = v;
  },
);

function volumeInput(e: Event): void {
  volumeLocal.value = Number((e.target as HTMLInputElement).value);
  const v = volumeLocal.value;
  const send = (): void => {
    lastVolumeSent = Date.now();
    if (!store.selectedDevice) return;
    // WS is the fast path; REST is the fallback while the socket is down
    const sent = sendWsCommand({ type: "setVolume", deviceId: store.selectedDevice, volume: v });
    if (!sent) void cmd(() => api.volume(store.selectedDevice!, v));
  };
  const now = Date.now();
  if (now - lastVolumeSent >= 250) {
    send();
  } else {
    if (volumeTimer) clearTimeout(volumeTimer);
    volumeTimer = setTimeout(send, 250); // trailing-edge throttle
  }
}

async function cmd(fn: () => Promise<unknown>): Promise<void> {
  if (!store.selectedDevice) return;
  try {
    await fn();
  } catch {
    // player offline etc
  }
  await refreshState();
}

function togglePlay(): void {
  if (!store.selectedDevice) return;
  const target = isPlaying.value ? "pause" : "resume";
  // WS fast path; REST fallback while the socket is down
  const sent = sendWsCommand({ type: target, deviceId: store.selectedDevice });
  if (!sent) void cmd(() => (isPlaying.value ? api.pause(store.selectedDevice!) : api.resume(store.selectedDevice!)));
}

function toggleShuffle(): void {
  if (!store.selectedDevice) return;
  const next = !(store.playback?.shuffle ?? false);
  const sent = sendWsCommand({ type: "shuffle", deviceId: store.selectedDevice, shuffle: next });
  if (!sent) void cmd(() => api.shuffle(store.selectedDevice!, next));
}

function cycleRepeat(): void {
  if (!store.selectedDevice) return;
  const order = ["off", "all", "one"] as const;
  const cur = store.playback?.repeat ?? "off";
  const next = order[(order.indexOf(cur) + 1) % order.length]!;
  const sent = sendWsCommand({ type: "repeat", deviceId: store.selectedDevice, mode: next });
  if (!sent) void cmd(() => api.repeat(store.selectedDevice!, next));
}

function transportNext(): void {
  if (!store.selectedDevice) return;
  const sent = sendWsCommand({ type: "next", deviceId: store.selectedDevice });
  if (!sent) void cmd(() => api.next(store.selectedDevice!));
}

function transportPrevious(): void {
  if (!store.selectedDevice) return;
  const sent = sendWsCommand({ type: "previous", deviceId: store.selectedDevice });
  if (!sent) void cmd(() => api.previous(store.selectedDevice!));
}

async function wake(): Promise<void> {
  if (!store.selectedDevice) return;
  try {
    await api.wake(store.selectedDevice);
    showToast(i18n.lang === "id" ? "Wake signal terkirim" : "Wake signal sent");
  } catch (e) {
    showToast(`${i18n.lang === "id" ? "Gagal: " : "Failed: "}${(e as Error).message}`, "error");
  }
}

// --- favorite & playlist for the CURRENT track ---
const isFav = computed(() => {
  const t = track.value;
  return !!t && store.favorites.some((f) => f.trackId === t.id);
});

async function toggleFav(): Promise<void> {
  const t = track.value;
  if (!t) return;
  if (isFav.value) {
    await api.removeFavorite(t.id).catch(() => null);
    showToast("Dihapus dari favorit");
  } else {
    await api.addFavorite(t).catch(() => null);
    showToast("Ditambahkan ke favorit");
  }
  await refreshFavorites();
}

const showSavePanel = ref(false);
const containsMap = ref<Record<string, boolean>>({});

async function toggleSavePanel(): Promise<void> {
  showSavePanel.value = !showSavePanel.value;
  if (showSavePanel.value && track.value) {
    await refreshPlaylists();
    const r = await api.playlistsWithTrack(track.value.id).catch(() => null);
    containsMap.value = Object.fromEntries((r?.playlists ?? []).map((p) => [p.id, p.contains]));
  }
}

async function togglePlaylist(playlistId: string): Promise<void> {
  const t = track.value;
  if (!t) return;
  const wasIn = containsMap.value[playlistId];
  const plName = store.playlists.find((p) => p.id === playlistId)?.name ?? "playlist";
  if (wasIn) {
    await api.removeFromPlaylist(playlistId, t.id).catch(() => null);
  } else {
    await api.addToPlaylist(playlistId, t).catch(() => null);
  }
  containsMap.value = { ...containsMap.value, [playlistId]: !wasIn };
  await refreshPlaylists();
  showToast(wasIn ? `Dihapus dari ${plName}` : `Ditambahkan ke ${plName}`);
}

async function saveMac(): Promise<void> {
  if (!store.selectedDevice || !macInput.value.trim()) return;
  try {
    await api.setDeviceMac(store.selectedDevice, macInput.value.trim());
    macInput.value = "";
    wakeMsg.value = "MAC tersimpan";
    await refreshDevices();
  } catch (e) {
    wakeMsg.value = `Gagal: ${(e as Error).message}`;
  }
}
</script>

<template>
  <div
    v-if="store.selectedDevice"
    class="fixed inset-x-0 bottom-0 z-50 border-t border-white/5 bg-[#101019]/95 shadow-[0_-8px_30px_rgba(0,0,0,0.45)] backdrop-blur"
  >
    <!-- seek slider (Spotify style: preview while dragging, commit on release) -->
    <div v-if="trackDuration > 0" class="relative px-1 pt-1">
      <span
        v-if="seekDragging"
        class="pointer-events-none absolute -top-2 left-1/2 -translate-x-1/2 rounded-md bg-black/85 px-1.5 py-0.5 text-[10px] font-medium text-white"
      >{{ formatDuration(seekLocal) }}</span>
      <input
        type="range"
        min="0"
        :max="trackDuration"
        step="1"
        :value="seekDisplay"
        :style="seekBarStyle"
        class="seek-slider h-1.5 w-full cursor-pointer appearance-none rounded-full"
        @pointerdown="onSeekStart"
        @input="onSeekInput"
        @change="onSeekCommit"
      />
      <!-- time labels: live current position (while sliding too) + total -->
      <div class="mt-0.5 flex justify-between text-[10px] font-medium text-neutral-500">
        <span>{{ formatDuration(seekDragging ? seekLocal : (store.playback?.position ?? 0)) }}</span>
        <span>{{ formatDuration(trackDuration) }}</span>
      </div>
    </div>
    <div v-else class="h-0.5 bg-white/10"></div>

    <div class="mx-auto flex max-w-md items-center gap-2.5 px-4 py-2">
      <!-- track info (tap → detail) -->
      <button class="flex min-w-0 flex-1 items-center gap-2 text-left" @click="showDetail = !showDetail">
        <img
          v-if="track?.thumbnail"
          :src="track.thumbnail"
          alt=""
          class="h-10 w-10 shrink-0 rounded-lg object-cover shadow-md"
        />
        <div class="min-w-0 flex-1">
          <div class="truncate text-sm font-semibold">
            {{ track?.title ?? (thisDevice && !thisDevice.online ? "Device offline" : "Tidak ada yang diputar") }}
          </div>
          <div class="truncate text-xs" :class="thisDevice && !thisDevice.online && !track ? 'text-amber-500/80' : 'text-neutral-500'">
            {{
              track?.artist
                ? `${track.artist} · ${formatDuration(track.duration ?? 0)}`
                : thisDevice && !thisDevice.online && activeOtherDevice
                  ? `Musik berjalan di ${activeOtherDevice.name || activeOtherDevice.id} — pilih di dropdown untuk pindah`
                  : thisDevice && !thisDevice.online
                    ? "Device ini offline — nyalakan player-nya dulu"
                    : "Pilih tab Cari untuk mulai"
            }}
          </div>
        </div>
      </button>

      <!-- controls -->
      <button
        class="rounded-full p-1.5 transition"
        :class="store.playback?.shuffle ? 'text-green-500' : 'text-neutral-400 hover:text-white'"
        :title="t('shuffle')"
        @click="toggleShuffle"
      >
        <Shuffle :size="16" />
      </button>
      <button class="rounded-full p-1.5 text-neutral-300 transition hover:text-white" @click="transportPrevious">
        <SkipBack :size="20" />
      </button>
      <button
        class="flex h-10 w-10 items-center justify-center rounded-full bg-green-500 text-black shadow-lg shadow-green-500/25 transition hover:scale-105 hover:bg-green-400"
        @click="togglePlay"
      >
        <Pause v-if="isPlaying" :size="18" />
        <Play v-else :size="18" class="ml-0.5" />
      </button>
      <button class="rounded-full p-1.5 text-neutral-300 transition hover:text-white" @click="transportNext">
        <SkipForward :size="20" />
      </button>
      <button
        class="rounded-full p-1.5 transition"
        :class="store.playback?.repeat !== 'off' ? 'text-green-500' : 'text-neutral-400 hover:text-white'"
        :title="store.playback?.repeat === 'one' ? t('repeatOne') : store.playback?.repeat === 'all' ? t('repeatAll') : t('repeatOff')"
        @click="cycleRepeat"
      >
        <Repeat1 v-if="store.playback?.repeat === 'one'" :size="16" />
        <Repeat v-else :size="16" />
      </button>

      <!-- volume (desktop): icon toggles mute, slider drags over WS (250ms) -->
      <div class="hidden w-20 items-center gap-1.5 sm:flex">
        <button
          class="shrink-0 text-neutral-500 transition hover:text-white"
          :title="volumeLocal > 0 ? t('mute') : t('unmute')"
          @click="toggleMute"
        >
          <Volume2 v-if="volumeLocal > 0" :size="14" />
          <VolumeX v-else :size="14" />
        </button>
        <input
          type="range"
          min="0"
          max="100"
          :value="volumeLocal"
          class="h-1 w-full cursor-pointer appearance-none rounded-full bg-white/10 accent-green-500"
          @input="volumeInput"
        />
      </div>

      <!-- more -->
      <button
        class="rounded-full p-1.5 transition"
        :class="showDetail ? 'bg-white/10 text-white' : 'text-neutral-400 hover:text-white'"
        @click="showDetail = !showDetail"
      >
        <MoreHorizontal :size="18" />
      </button>
    </div>

    <!-- detail panel (device, volume mobile, wake) -->
    <div v-if="showDetail" class="border-t border-white/5 bg-[#14141c]">
      <div class="mx-auto max-w-md space-y-3 px-4 py-3 text-sm">
        <div class="flex items-center justify-between gap-3">
          <span class="shrink-0 text-xs font-medium uppercase tracking-wider text-neutral-500">
            {{ t("playingOn") }}
          </span>
          <div class="w-48">
            <DeviceSelector />
          </div>
        </div>

        <!-- save current track: favorite / playlist -->
        <div v-if="track" class="relative border-t border-white/5 pt-3">
          <div class="flex items-center justify-between gap-3">
            <span class="shrink-0 text-xs font-medium uppercase tracking-wider text-neutral-500">
              {{ t("saveTrack") }}
            </span>
            <div class="flex items-center gap-1">
              <button
                class="rounded-lg p-2 transition"
                :class="isFav ? 'text-red-500' : 'text-neutral-400 hover:bg-white/10 hover:text-red-400'"
                :title="isFav ? t('removeFavorite') : t('addFavorite')"
                @click="toggleFav"
              >
                <Heart :size="15" :fill="isFav ? 'currentColor' : 'none'" />
              </button>
              <button
                class="rounded-lg p-2 text-neutral-400 transition hover:bg-white/10 hover:text-white"
                :title="showSavePanel ? t('close') : t('saveToPlaylist')"
                @click="toggleSavePanel"
              >
                <FolderPlus :size="15" />
              </button>
            </div>
          </div>

          <!-- playlist picker (toggles, opens upward) -->
          <div
            v-if="showSavePanel"
            class="absolute bottom-full right-0 z-10 mb-1 w-56 rounded-xl border border-white/10 bg-[#1c1c26] p-2 shadow-2xl shadow-black/60"
          >
            <div v-if="store.playlists.length" class="flex max-h-44 flex-wrap gap-1 overflow-y-auto">
              <button
                v-for="p in store.playlists"
                :key="p.id"
                class="rounded-lg px-2.5 py-1.5 text-xs font-medium transition"
                :class="containsMap[p.id] ? 'bg-green-500 text-black' : 'bg-white/10 hover:bg-green-500 hover:text-black'"
                :title="containsMap[p.id] ? t('removeFavorite') : t('saveToPlaylist')"
                @click="togglePlaylist(p.id)"
              >
                {{ p.name }}{{ containsMap[p.id] ? " ✓" : "" }}
              </button>
            </div>
            <p v-else class="text-xs text-neutral-500">{{ t("noPlaylists") }}</p>
          </div>
        </div>

        <div class="flex items-center gap-2 sm:hidden">
          <Volume2 :size="16" class="shrink-0 text-neutral-500" />
          <input
            type="range"
            min="0"
            max="100"
            :value="volumeLocal"
            class="h-1 w-full cursor-pointer appearance-none rounded-full bg-white/10 accent-green-500"
            @input="volumeInput"
          />
          <span class="w-8 shrink-0 text-right text-xs text-neutral-500">{{ volumeLocal }}</span>
        </div>

        <div v-if="thisDevice && !thisDevice.online" class="rounded-lg bg-black/30 p-2.5 text-center text-xs">
          <p class="mb-1.5 text-neutral-500">{{ thisDevice.name || thisDevice.id }} sedang offline</p>
          <template v-if="thisDevice.macAddress">
            <button
              class="flex items-center gap-1.5 rounded-lg bg-amber-500/90 px-3 py-1.5 font-semibold text-black transition hover:bg-amber-400"
              @click="wake"
            >
              <Power :size="13" />
              {{ t("wake") }}
            </button>
          </template>
          <template v-else>
            <div class="flex items-center gap-2">
              <input
                v-model="macInput"
                :placeholder="t('macPlaceholder')"
                class="w-44 rounded bg-black/40 px-2 py-1.5 text-xs outline-none"
              />
              <button class="rounded-lg bg-white/10 px-3.5 py-1.5 transition hover:bg-white/15" @click="saveMac">
                Simpan
              </button>
            </div>
          </template>
          <p v-if="wakeMsg" class="mt-1.5 text-neutral-400">{{ wakeMsg }}</p>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* seek thumb: hidden at rest, appears on hover (desktop) / while dragging */
.seek-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 12px;
  height: 12px;
  border-radius: 9999px;
  background: #22c55e;
  box-shadow: 0 0 6px rgba(34, 197, 94, 0.5);
  opacity: 0;
  transition: opacity 0.15s ease;
  cursor: grab;
}
.seek-slider:hover::-webkit-slider-thumb,
.seek-slider:active::-webkit-slider-thumb {
  opacity: 1;
}
.seek-slider::-moz-range-thumb {
  width: 12px;
  height: 12px;
  border: none;
  border-radius: 9999px;
  background: #22c55e;
  opacity: 0;
  transition: opacity 0.15s ease;
  cursor: grab;
}
.seek-slider:hover::-moz-range-thumb,
.seek-slider:active::-moz-range-thumb {
  opacity: 1;
}
</style>
