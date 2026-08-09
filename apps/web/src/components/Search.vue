<script setup lang="ts">
import { ref } from "vue";
import { api, type TrackDTO } from "../lib/api";
import { store, refreshQueue, refreshState, refreshPlaylists } from "../composables/useMusic";
import { formatDuration } from "../lib/format";

const query = ref("");
const results = ref<TrackDTO[]>([]);
const busy = ref(false);
const saveFor = ref<TrackDTO | null>(null);

async function doSearch(): Promise<void> {
  if (!query.value.trim()) return;
  busy.value = true;
  try {
    results.value = (await api.search(query.value)).tracks;
  } finally {
    busy.value = false;
  }
}

async function playNow(track: TrackDTO): Promise<void> {
  if (!store.selectedDevice) return;
  // send full metadata from the search result — server uses it directly
  // (no oEmbed fallback → correct artist + duration immediately)
  await api.play(store.selectedDevice, track.id, track);
  await refreshState();
}

async function addToQueue(track: TrackDTO): Promise<void> {
  if (!store.selectedDevice) return;
  await api.addToQueue(store.selectedDevice, track);
  await refreshQueue();
}

async function favorite(track: TrackDTO): Promise<void> {
  await api.addFavorite(track);
}

async function saveToPlaylist(playlistId: string): Promise<void> {
  if (!saveFor.value) return;
  await api.addToPlaylist(playlistId, saveFor.value);
  saveFor.value = null;
  await refreshPlaylists();
}
</script>

<template>
  <section class="mb-4">
    <form class="flex gap-2" @submit.prevent="doSearch">
      <input
        v-model="query"
        type="search"
        placeholder="🔎 Search YouTube Music"
        class="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm outline-none focus:border-green-500"
      />
      <button
        type="submit"
        :disabled="busy"
        class="rounded-lg bg-gray-700 px-3 text-sm hover:bg-gray-600 disabled:opacity-50"
      >
        {{ busy ? "..." : "Cari" }}
      </button>
    </form>

    <ul
      v-if="results.length"
      class="mt-2 divide-y divide-gray-800 rounded-lg border border-gray-800 bg-gray-900"
    >
      <li
        v-for="t in results"
        :key="t.id"
        class="flex items-center justify-between gap-2 px-3 py-2 text-sm"
      >
        <div class="min-w-0">
          <div class="truncate font-medium">{{ t.title }}</div>
          <div class="truncate text-xs text-gray-400">
            {{ t.artist }} · {{ formatDuration(t.duration) }}
          </div>
        </div>
        <div class="flex shrink-0 gap-1">
          <button
            class="rounded bg-green-600/80 px-2 py-1 text-xs hover:bg-green-500"
            title="Putar sekarang"
            @click="playNow(t)"
          >
            ▶
          </button>
          <button
            class="rounded bg-gray-700 px-2 py-1 text-xs hover:bg-gray-600"
            title="Tambahkan ke queue"
            @click="addToQueue(t)"
          >
            +
          </button>
          <button
            class="rounded bg-gray-700 px-2 py-1 text-xs hover:bg-gray-600"
            title="Favorite"
            @click="favorite(t)"
          >
            ❤
          </button>
          <button
            class="rounded bg-gray-700 px-2 py-1 text-xs hover:bg-gray-600"
            title="Simpan ke playlist"
            @click="saveFor = saveFor?.id === t.id ? null : t"
          >
            📁
          </button>
        </div>
        <div
          v-if="saveFor?.id === t.id"
          class="absolute inset-x-4 z-10 mt-1 rounded-lg border border-gray-600 bg-gray-800 p-2 shadow-xl"
        >
          <div v-if="store.playlists.length" class="flex flex-wrap gap-1">
            <button
              v-for="p in store.playlists"
              :key="p.id"
              class="rounded bg-gray-700 px-2 py-1 text-xs hover:bg-green-600"
              @click="saveToPlaylist(p.id)"
            >
              {{ p.name }}
            </button>
          </div>
          <p v-else class="text-xs text-gray-500">Belum ada playlist — buat di tab Playlists</p>
        </div>
      </li>
    </ul>
  </section>
</template>
