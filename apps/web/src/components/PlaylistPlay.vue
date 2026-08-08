<script setup lang="ts">
import { ref } from "vue";
import { api } from "../lib/api";
import { store, refreshQueue, refreshState } from "../composables/useMusic";

const input = ref("");
const msg = ref("");
const busy = ref(false);

async function play(): Promise<void> {
  if (!store.selectedDevice || !input.value.trim()) return;
  busy.value = true;
  msg.value = "";
  try {
    const r = await api.playPlaylist(store.selectedDevice, input.value.trim());
    msg.value = `✅ ${r.queued} lagu masuk queue — sekarang: ${r.first?.title ?? "..."}`;
    await refreshQueue();
    await refreshState();
  } catch (e) {
    msg.value = `❌ ${(e as Error).message}`;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <section class="mb-4 rounded-2xl border border-gray-700 bg-gray-800 p-3">
    <h2 class="mb-2 text-xs font-semibold text-gray-300">📋 Play Playlist (YouTube Music)</h2>
    <div class="flex gap-2">
      <input
        v-model="input"
        placeholder="Tautan atau ID playlist (mis. https://music.youtube.com/playlist?list=PL...)"
        class="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm outline-none focus:border-green-500"
      />
      <button
        :disabled="busy || !input.trim()"
        class="shrink-0 rounded-lg bg-green-500 px-3 text-sm font-semibold text-black hover:bg-green-400 disabled:opacity-50"
        @click="play"
      >
        {{ busy ? "..." : "▶ Putar" }}
      </button>
    </div>
    <p v-if="msg" class="mt-2 text-xs text-gray-400">{{ msg }}</p>
  </section>
</template>
