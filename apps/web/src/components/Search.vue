<script setup lang="ts">
import { ref } from "vue";
import { Search as SearchIcon, Play, Plus, Heart, FolderPlus, X } from "lucide-vue-next";
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

/** Reset search: clear the input and any results. */
function resetSearch(): void {
  query.value = "";
  results.value = [];
  saveFor.value = null;
}

async function playNow(track: TrackDTO): Promise<void> {
  if (!store.selectedDevice) return;
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

/** Toggle playlist picker — refresh the list first (login may not have loaded it). */
async function toggleSaveFor(t: TrackDTO): Promise<void> {
  saveFor.value = saveFor.value?.id === t.id ? null : t;
  if (saveFor.value) await refreshPlaylists();
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
      <div class="relative w-full">
        <SearchIcon :size="16" class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500" />
        <input
          v-model="query"
          type="search"
          placeholder="Cari lagu atau artis…"
          class="w-full rounded-xl border border-white/5 bg-[#14141c] py-2.5 pl-9 pr-9 text-sm outline-none placeholder:text-neutral-600 focus:border-green-500/40"
        />
        <button
          v-if="query || results.length"
          class="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-full p-0.5 text-neutral-500 transition hover:bg-white/10 hover:text-white"
          title="Reset pencarian"
          @click="resetSearch"
        >
          <X :size="14" />
        </button>
      </div>
      <button
        type="submit"
        :disabled="busy"
        class="rounded-xl bg-white/10 px-4 text-sm font-medium transition hover:bg-white/15 disabled:opacity-50"
      >
        {{ busy ? "..." : "Cari" }}
      </button>
    </form>

    <ul
      v-if="results.length"
      class="mt-3 divide-y divide-white/5 rounded-xl border border-white/5 bg-[#14141c]"
    >
      <li
        v-for="t in results"
        :key="t.id"
        class="group relative flex items-center gap-3 px-3 py-2.5 transition hover:bg-white/5"
      >
        <div class="min-w-0 flex-1">
          <div class="truncate text-sm font-medium">{{ t.title }}</div>
          <div class="truncate text-xs text-neutral-500">
            {{ t.artist }} · {{ formatDuration(t.duration) }}
          </div>
        </div>
        <div class="flex shrink-0 items-center gap-1">
          <button
            class="rounded-lg bg-green-500/90 p-1.5 text-black transition hover:bg-green-400"
            title="Putar sekarang"
            @click="playNow(t)"
          >
            <Play :size="14" />
          </button>
          <button
            class="rounded-lg p-1.5 text-neutral-400 transition hover:bg-white/10 hover:text-white"
            title="Tambahkan ke queue"
            @click="addToQueue(t)"
          >
            <Plus :size="14" />
          </button>
          <button
            class="rounded-lg p-1.5 text-neutral-400 transition hover:bg-white/10 hover:text-red-400"
            title="Favorite"
            @click="favorite(t)"
          >
            <Heart :size="14" />
          </button>
          <button
            class="rounded-lg p-1.5 text-neutral-400 transition hover:bg-white/10 hover:text-white"
            title="Simpan ke playlist"
            @click="toggleSaveFor(t)"
          >
            <FolderPlus :size="14" />
          </button>
        </div>
        <div
          v-if="saveFor?.id === t.id"
          class="absolute inset-x-3 top-full z-10 mt-1 rounded-xl border border-white/10 bg-[#1c1c26] p-2 shadow-2xl shadow-black/60"
        >
          <div v-if="store.playlists.length" class="flex flex-wrap gap-1">
            <button
              v-for="p in store.playlists"
              :key="p.id"
              class="rounded-lg bg-white/10 px-2.5 py-1.5 text-xs font-medium transition hover:bg-green-500 hover:text-black"
              @click="saveToPlaylist(p.id)"
            >
              {{ p.name }}
            </button>
          </div>
          <p v-else class="text-xs text-neutral-500">Belum ada playlist — buat di tab Playlist</p>
        </div>
      </li>
    </ul>
  </section>
</template>
