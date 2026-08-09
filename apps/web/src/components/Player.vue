<script setup lang="ts">
import { computed, ref, watch } from "vue";
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Volume2,
  Power,
  MoreHorizontal,
} from "lucide-vue-next";
import { api } from "../lib/api";
import { store, refreshState, refreshDevices } from "../composables/useMusic";
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

const showDetail = ref(false);
const macInput = ref("");
const wakeMsg = ref("");

// Volume: local ref for instant slider feedback, debounced commit to the API.
const volumeLocal = ref(70);
let volumeTimer: ReturnType<typeof setTimeout> | null = null;

watch(
  () => pb.value?.volume,
  (v) => {
    if (v !== undefined && Math.abs(v - volumeLocal.value) > 3) volumeLocal.value = v;
  },
);

function volumeInput(e: Event): void {
  volumeLocal.value = Number((e.target as HTMLInputElement).value);
  if (volumeTimer) clearTimeout(volumeTimer);
  volumeTimer = setTimeout(() => {
    if (store.selectedDevice) void cmd(() => api.volume(store.selectedDevice!, volumeLocal.value));
  }, 400);
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
  void cmd(() => (isPlaying.value ? api.pause(store.selectedDevice!) : api.resume(store.selectedDevice!)));
}

async function wake(): Promise<void> {
  if (!store.selectedDevice) return;
  try {
    await api.wake(store.selectedDevice);
    wakeMsg.value = "Magic packet terkirim — PC menyala dalam beberapa detik";
  } catch (e) {
    wakeMsg.value = `Gagal: ${(e as Error).message}`;
  }
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
    <!-- progress line -->
    <div class="h-0.5 bg-white/10">
      <div class="h-full bg-green-500 transition-all" :style="{ width: `${progressPct}%` }"></div>
    </div>

    <div class="mx-auto flex max-w-md items-center gap-2.5 px-4 py-2">
      <!-- track info (tap → detail) -->
      <button class="flex min-w-0 flex-1 items-center gap-2 text-left" @click="showDetail = !showDetail">
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
      <button class="rounded-full p-1.5 text-neutral-300 transition hover:text-white" @click="cmd(() => api.previous(store.selectedDevice!))">
        <SkipBack :size="20" />
      </button>
      <button
        class="flex h-10 w-10 items-center justify-center rounded-full bg-green-500 text-black shadow-lg shadow-green-500/25 transition hover:scale-105 hover:bg-green-400"
        @click="togglePlay"
      >
        <Pause v-if="isPlaying" :size="18" />
        <Play v-else :size="18" class="ml-0.5" />
      </button>
      <button class="rounded-full p-1.5 text-neutral-300 transition hover:text-white" @click="cmd(() => api.next(store.selectedDevice!))">
        <SkipForward :size="20" />
      </button>

      <!-- volume (desktop) -->
      <div class="hidden w-20 items-center gap-1.5 sm:flex">
        <Volume2 :size="14" class="shrink-0 text-neutral-500" />
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
            Memutar di
          </span>
          <div class="w-48">
            <DeviceSelector />
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
              Wake (WOL)
            </button>
          </template>
          <template v-else>
            <input
              v-model="macInput"
              placeholder="MAC: 00:D8:61:BD:87:DD"
              class="mr-1 w-44 rounded bg-black/40 px-2 py-1.5 text-xs outline-none"
            />
            <button class="rounded-lg bg-white/10 px-2.5 py-1.5 transition hover:bg-white/15" @click="saveMac">
              Simpan
            </button>
          </template>
          <p v-if="wakeMsg" class="mt-1.5 text-neutral-400">{{ wakeMsg }}</p>
        </div>
      </div>
    </div>
  </div>
</template>
