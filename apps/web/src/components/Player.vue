<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { api } from "../lib/api";
import { store, refreshState, refreshAll, refreshDevices } from "../composables/useMusic";
import { formatDuration } from "../lib/format";

const pb = computed(() => store.playback);
const isPlaying = computed(() => pb.value?.state === "playing");
const track = computed(() => pb.value?.track ?? null);
const otherDevices = computed(() => store.devices.filter((d) => d.id !== store.selectedDevice));
const thisDevice = computed(() => store.devices.find((d) => d.id === store.selectedDevice) ?? null);

// Volume: local ref for instant slider feedback, debounced commit to the API
// (dragging fires dozens of @input events — each one would hit the rate limit).
const volumeLocal = ref(70);
let volumeTimer: ReturnType<typeof setTimeout> | null = null;

function syncVolumeFromState(v: number | undefined): void {
  if (v !== undefined && Math.abs(v - volumeLocal.value) > 3) volumeLocal.value = v;
}
watch(
  () => pb.value?.volume,
  (v) => syncVolumeFromState(v),
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

/** Remote wake-up via MikroTik (Phase 9) — for offline devices with a MAC set. */
async function wake(): Promise<void> {
  if (!store.selectedDevice) return;
  try {
    await api.wake(store.selectedDevice);
    wakeMsg.value = "⚡ Magic packet terkirim — PC menyala dalam beberapa detik";
  } catch (e) {
    wakeMsg.value = `❌ ${(e as Error).message}`;
  }
}

async function saveMac(): Promise<void> {
  if (!store.selectedDevice || !macInput.value.trim()) return;
  try {
    await api.setDeviceMac(store.selectedDevice, macInput.value.trim());
    macInput.value = "";
    wakeMsg.value = "✅ MAC tersimpan";
    await refreshDevices();
  } catch (e) {
    wakeMsg.value = `❌ ${(e as Error).message}`;
  }
}

async function cmd(fn: () => Promise<unknown>): Promise<void> {
  if (!store.selectedDevice) return;
  try {
    await fn();
  } catch {
    // player offline / errors surface via next poll
  }
  await refreshState();
}

function togglePlay(): void {
  if (!store.selectedDevice) return;
  void cmd(() => (isPlaying.value ? api.pause(store.selectedDevice!) : api.resume(store.selectedDevice!)));
}

function changeVolume(e: Event): void {
  const v = Number((e.target as HTMLInputElement).value);
  if (!store.selectedDevice) return;
  void cmd(() => api.volume(store.selectedDevice!, v));
}

/** Device handoff (PRD §26, Phase 7): position carries over, target keeps its volume. */
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
  <section class="mb-4 rounded-2xl border border-gray-700 bg-gray-800 p-4">
    <div class="mb-3 text-center">
      <div class="text-sm font-semibold text-gray-400">
        🎵 Playing on {{ store.selectedDevice }}
      </div>
      <div class="mt-2 truncate text-lg font-bold">{{ track?.title ?? "Nothing playing" }}</div>
      <div class="truncate text-sm text-gray-400">{{ track?.artist ?? "—" }}</div>
    </div>

    <div class="mb-2 text-center text-xs text-gray-500">
      {{ formatDuration(pb?.position ?? 0) }} / {{ formatDuration(track?.duration ?? 0) }}
    </div>
    <div class="mb-4 h-1 rounded bg-gray-700">
      <div
        class="h-1 rounded bg-green-500"
        :style="{ width: track?.duration ? `${Math.min(100, ((pb?.position ?? 0) / track.duration) * 100)}%` : '0%' }"
      ></div>
    </div>

    <div class="flex items-center justify-center gap-6 text-2xl">
      <button class="text-gray-300 hover:text-white" title="Sebelumnya" @click="cmd(() => api.previous(store.selectedDevice!))">
        ⏮
      </button>
      <button
        class="rounded-full bg-green-500 px-6 py-2 text-black hover:bg-green-400"
        @click="togglePlay"
      >
        {{ isPlaying ? "❚❚" : "▶" }}
      </button>
      <button class="text-gray-300 hover:text-white" title="Berikutnya" @click="cmd(() => api.next(store.selectedDevice!))">
        ⏭
      </button>
    </div>

    <div class="mt-4 flex items-center gap-2 text-sm">
      <span>🔊</span>
      <input
        type="range"
        min="0"
        max="100"
        :value="volumeLocal"
        class="w-full accent-green-500"
        @input="volumeInput"
      />
      <span class="w-8 text-right text-xs text-gray-400">{{ volumeLocal }}</span>
    </div>

    <div v-if="otherDevices.length" class="mt-3 flex items-center justify-center gap-2 text-xs">
      <span class="text-gray-500">⇄ Pindahkan ke:</span>
      <select class="rounded-lg border border-gray-700 bg-gray-900 px-2 py-1" @change="transferTo">
        <option value="" selected disabled>pilih device…</option>
        <option v-for="d in otherDevices" :key="d.id" :value="d.id">
          {{ d.name || d.id }} {{ d.online ? "🟢" : "⚪" }}
        </option>
      </select>
    </div>

    <div v-if="thisDevice && !thisDevice.online" class="mt-3 rounded-lg bg-gray-900 p-2 text-center text-xs">
      <p class="mb-1 text-gray-400">{{ thisDevice.name || thisDevice.id }} sedang offline</p>
      <template v-if="thisDevice.macAddress">
        <button class="rounded bg-amber-500/80 px-3 py-1 font-semibold text-black hover:bg-amber-400" @click="wake">
          ⚡ Wake (WOL)
        </button>
      </template>
      <template v-else>
        <input
          v-model="macInput"
          placeholder="MAC: 00:D8:61:BD:87:DD"
          class="mr-1 w-44 rounded bg-gray-800 px-2 py-1 text-xs outline-none"
        />
        <button class="rounded bg-gray-600 px-2 py-1 hover:bg-gray-500" @click="saveMac">Simpan</button>
      </template>
      <p v-if="wakeMsg" class="mt-1 text-gray-400">{{ wakeMsg }}</p>
    </div>
  </section>
</template>
