<script setup lang="ts">
import { computed } from "vue";
import { api } from "../lib/api";
import { store, refreshState } from "../composables/useMusic";
import { formatDuration } from "../lib/format";

const pb = computed(() => store.playback);
const isPlaying = computed(() => pb.value?.state === "playing");
const track = computed(() => pb.value?.track ?? null);
const volume = computed(() => pb.value?.volume ?? 70);

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
        :value="volume"
        class="w-full accent-green-500"
        @input="changeVolume"
      />
      <span class="w-8 text-right text-xs text-gray-400">{{ volume }}</span>
    </div>
  </section>
</template>
