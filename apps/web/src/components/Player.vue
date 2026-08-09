<script setup lang="ts">
import { computed, ref, watch } from "vue";
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Volume2,
  ArrowRightLeft,
  Power,
} from "lucide-vue-next";
import { api } from "../lib/api";
import { store, refreshState, refreshAll, refreshDevices } from "../composables/useMusic";
import { formatDuration } from "../lib/format";

const pb = computed(() => store.playback);
const isPlaying = computed(() => pb.value?.state === "playing");
const track = computed(() => pb.value?.track ?? null);
const otherDevices = computed(() => store.devices.filter((d) => d.id !== store.selectedDevice));
const thisDevice = computed(() => store.devices.find((d) => d.id === store.selectedDevice) ?? null);
const progressPct = computed(() => {
  const d = track.value?.duration ?? 0;
  return d > 0 ? Math.min(100, ((pb.value?.position ?? 0) / d) * 100) : 0;
});

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

const macInput = ref("");
const wakeMsg = ref("");

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

async function transferTo(e: Event): Promise<void> {
  const to = (e.target as HTMLSelectElement).value;
  if (!store.selectedDevice || !to) return;
  try {
    await api.transfer(store.selectedDevice, to);
  } catch {
    // target offline etc
  }
  await refreshAll();
}
</script>

<template>
  <section class="mb-4 rounded-2xl border border-white/5 bg-[#14141c] p-5">
    <div class="mb-1 text-center text-[11px] font-semibold uppercase tracking-widest text-neutral-500">
      Sedang diputar di {{ store.selectedDevice }}
    </div>
    <div class="mb-3 text-center">
      <div class="truncate text-lg font-bold tracking-tight">
        {{ track?.title ?? "Tidak ada yang diputar" }}
      </div>
      <div class="truncate text-sm text-neutral-500">{{ track?.artist ?? "—" }}</div>
    </div>

    <div class="mb-1 flex items-center justify-between text-xs text-neutral-500">
      <span>{{ formatDuration(pb?.position ?? 0) }}</span>
      <span>{{ formatDuration(track?.duration ?? 0) }}</span>
    </div>
    <div class="mb-4 h-1 overflow-hidden rounded-full bg-white/10">
      <div class="h-full rounded-full bg-green-500 transition-all" :style="{ width: `${progressPct}%` }"></div>
    </div>

    <div class="flex items-center justify-center gap-8">
      <button
        class="text-neutral-300 transition hover:text-white"
        title="Sebelumnya"
        @click="cmd(() => api.previous(store.selectedDevice!))"
      >
        <SkipBack :size="26" />
      </button>
      <button
        class="flex h-14 w-14 items-center justify-center rounded-full bg-green-500 text-black shadow-lg shadow-green-500/25 transition hover:scale-105 hover:bg-green-400"
        @click="togglePlay"
      >
        <Pause v-if="isPlaying" :size="26" />
        <Play v-else :size="26" class="ml-0.5" />
      </button>
      <button
        class="text-neutral-300 transition hover:text-white"
        title="Berikutnya"
        @click="cmd(() => api.next(store.selectedDevice!))"
      >
        <SkipForward :size="26" />
      </button>
    </div>

    <div class="mt-5 flex items-center gap-2 text-sm">
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

    <div v-if="otherDevices.length" class="mt-4 flex items-center justify-center gap-2 rounded-lg bg-black/30 px-3 py-2 text-xs">
      <ArrowRightLeft :size="13" class="text-neutral-500" />
      <span class="text-neutral-500">Pindahkan ke:</span>
      <select class="bg-transparent outline-none" @change="transferTo">
        <option value="" selected disabled>pilih device…</option>
        <option v-for="d in otherDevices" :key="d.id" :value="d.id">
          {{ d.name || d.id }}{{ d.online ? "" : " (offline)" }}
        </option>
      </select>
    </div>

    <div v-if="thisDevice && !thisDevice.online" class="mt-3 rounded-lg bg-black/30 p-2.5 text-center text-xs">
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
  </section>
</template>
