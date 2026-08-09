<script setup lang="ts">
import { onMounted, ref } from "vue";
import { api, type FavoriteDTO } from "../lib/api";
import { store, refreshQueue, refreshState } from "../composables/useMusic";

const favorites = ref<FavoriteDTO[]>([]);

async function load(): Promise<void> {
  favorites.value = (await api.favorites()).favorites;
}

async function playTrack(trackId: string): Promise<void> {
  if (!store.selectedDevice) return;
  await api.play(store.selectedDevice, trackId);
  await refreshState();
}

async function unfavorite(trackId: string): Promise<void> {
  await api.removeFavorite(trackId);
  await load();
}

onMounted(load);
</script>

<template>
  <section class="mb-4 rounded-2xl border border-gray-700 bg-gray-800 p-4">
    <h2 class="mb-2 text-sm font-semibold text-gray-300">❤️ Favorites</h2>
    <ul v-if="favorites.length" class="divide-y divide-gray-800">
      <li v-for="f in favorites" :key="f.trackId" class="flex items-center justify-between gap-2 py-2 text-sm">
        <div class="min-w-0 flex-1">
          <div class="truncate font-medium">{{ f.title }}</div>
          <div class="truncate text-xs text-gray-500">{{ f.artist }}</div>
        </div>
        <button class="rounded bg-green-600/80 px-2 py-1 text-xs hover:bg-green-500" @click="playTrack(f.trackId)">▶</button>
        <button class="px-1 text-xs text-gray-500 hover:text-red-400" @click="unfavorite(f.trackId)">✕</button>
      </li>
    </ul>
    <p v-else class="py-3 text-center text-sm text-gray-500">Belum ada favorite — tap ❤ di hasil Search.</p>
  </section>
</template>
