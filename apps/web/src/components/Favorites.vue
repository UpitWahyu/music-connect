<script setup lang="ts">
import { onMounted } from "vue";
import { Heart, Play, X } from "lucide-vue-next";
import { api } from "../lib/api";
import { store, refreshFavorites, refreshState } from "../composables/useMusic";
import { showToast } from "../composables/useToast";

async function playTrack(trackId: string, title: string, artist: string): Promise<void> {
  if (!store.selectedDevice) return;
  await api.play(store.selectedDevice, trackId, {
    id: trackId,
    provider: "youtube-music",
    title,
    artist,
    duration: 0,
  });
  await refreshState();
}

async function unfavorite(trackId: string): Promise<void> {
  await api.removeFavorite(trackId);
  await refreshFavorites();
  showToast("Dihapus dari favorit");
}

onMounted(() => {
  void refreshFavorites();
});
</script>

<template>
  <section class="mb-4 rounded-2xl border border-white/5 bg-[#14141c] p-4">
    <h2 class="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-neutral-400">
      <Heart :size="14" />
      Favorit
    </h2>
    <ul v-if="store.favorites.length" class="divide-y divide-white/5">
      <li v-for="f in store.favorites" :key="f.trackId" class="flex items-center gap-3 py-2 text-sm">
        <div class="min-w-0 flex-1">
          <div class="truncate font-medium">{{ f.title }}</div>
          <div class="truncate text-xs text-neutral-500">{{ f.artist }}</div>
        </div>
        <button
          class="rounded-lg bg-green-500/90 p-1.5 text-black transition hover:bg-green-400 disabled:cursor-not-allowed disabled:opacity-40"
          :disabled="!store.selectedDevice"
          @click="playTrack(f.trackId, f.title, f.artist)"
        >
          <Play :size="13" />
        </button>
        <button
          class="rounded-lg p-1.5 text-neutral-500 transition hover:bg-white/10 hover:text-red-400"
          @click="unfavorite(f.trackId)"
        >
          <X :size="13" />
        </button>
      </li>
    </ul>
    <p v-else class="py-3 text-center text-sm text-neutral-500">
      Belum ada favorit — tap ikon hati di hasil pencarian
    </p>
  </section>
</template>
