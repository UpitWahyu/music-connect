<script setup lang="ts">
import { ref } from "vue";
import { ListMusic, Play } from "lucide-vue-next";
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
    msg.value = `${r.queued} lagu masuk queue — sekarang: ${r.first?.title ?? "..."}`;
    await refreshQueue();
    await refreshState();
  } catch (e) {
    msg.value = `Gagal: ${(e as Error).message}`;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <section class="mb-4 rounded-xl border border-white/5 bg-[#14141c] p-3">
    <h2 class="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-neutral-400">
      <ListMusic :size="14" />
      Putar Playlist
    </h2>
    <div class="flex gap-2">
      <input
        v-model="input"
        placeholder="Tautan / ID playlist YouTube Music…"
        class="w-full rounded-lg border border-white/5 bg-black/30 px-3 py-2 text-sm outline-none placeholder:text-neutral-600 focus:border-green-500/40"
      />
      <button
        :disabled="busy || !input.trim()"
        class="flex shrink-0 items-center gap-1.5 rounded-lg bg-green-500 px-3 text-sm font-semibold text-black transition hover:bg-green-400 disabled:opacity-50"
        @click="play"
      >
        <Play :size="14" />
        Putar
      </button>
    </div>
    <p v-if="msg" class="mt-2 text-xs text-neutral-400">{{ msg }}</p>
  </section>
</template>
