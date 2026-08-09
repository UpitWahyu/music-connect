<script setup lang="ts">
import { computed, ref } from "vue";
import { ListMusic, Music2, Play, Sparkles, Heart, FolderPlus } from "lucide-vue-next";
import { api, type QueueItemDTO } from "../lib/api";
import { store, refreshQueue, refreshState, refreshPlaylists } from "../composables/useMusic";
import { formatDuration } from "../lib/format";

const playingIndex = computed(() => store.queueIndex);

// --- play item ---
async function playItem(itemId: string): Promise<void> {
  if (!store.selectedDevice) return;
  try {
    await api.playQueueItem(store.selectedDevice, itemId);
    await refreshState();
  } catch {
    // player offline etc
  }
}

// --- favorite / save to playlist (same actions as search results) ---
async function favorite(item: QueueItemDTO): Promise<void> {
  await api.addFavorite(item.track).catch(() => null);
}

const saveFor = ref<QueueItemDTO | null>(null);

async function saveToPlaylist(playlistId: string): Promise<void> {
  if (!saveFor.value) return;
  await api.addToPlaylist(playlistId, saveFor.value.track).catch(() => null);
  saveFor.value = null;
  await refreshPlaylists();
}
</script>

<template>
  <section class="rounded-2xl border border-white/5 bg-[#14141c] p-4">
    <div class="mb-2 flex items-center justify-between">
      <h2 class="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-neutral-400">
        <ListMusic :size="14" />
        Antrian
        <span class="text-neutral-600">({{ store.queue.length }})</span>
      </h2>
    </div>

    <ul v-if="store.queue.length" class="divide-y divide-white/5">
      <li
        v-for="(item, i) in store.queue"
        :key="item.id"
        class="relative flex items-center gap-3 py-2 text-sm transition hover:bg-white/5"
      >
        <button
          class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition"
          :class="i === playingIndex ? 'bg-green-500 text-black' : 'bg-white/10 text-neutral-300 hover:bg-green-500 hover:text-black'"
          :title="i === playingIndex ? 'Sedang diputar — klik untuk ulang' : 'Putar sekarang'"
          @click="playItem(item.id)"
        >
          <Play v-if="i !== playingIndex" :size="12" class="ml-0.5" />
          <Music2 v-else :size="12" />
        </button>
        <div class="min-w-0 flex-1">
          <div class="truncate font-medium" :class="{ 'text-green-400': i === playingIndex }">
            {{ item.track.title }}
          </div>
          <div class="truncate text-xs text-neutral-500">{{ item.track.artist }}</div>
        </div>
        <span v-if="item.addedBy === 'auto'" class="flex shrink-0 items-center gap-1 rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-neutral-400" title="Rekomendasi otomatis">
          <Sparkles :size="9" />
          auto
        </span>
        <span class="shrink-0 text-xs text-neutral-600">{{ formatDuration(item.track.duration) }}</span>
        <div class="flex shrink-0 items-center gap-0.5">
          <button
            class="rounded-lg p-1.5 text-neutral-500 transition hover:bg-white/10 hover:text-red-400"
            title="Tambah ke favorit"
            @click="favorite(item)"
          >
            <Heart :size="13" />
          </button>
          <button
            class="rounded-lg p-1.5 text-neutral-500 transition hover:bg-white/10 hover:text-white"
            title="Simpan ke playlist"
            @click="saveFor = saveFor?.id === item.id ? null : item"
          >
            <FolderPlus :size="13" />
          </button>
        </div>

        <!-- playlist picker (opens upward so the player bar never covers it) -->
        <div
          v-if="saveFor?.id === item.id"
          class="absolute bottom-full right-0 z-10 mb-1 w-52 rounded-xl border border-white/10 bg-[#1c1c26] p-2 shadow-2xl shadow-black/60"
        >
          <div v-if="store.playlists.length" class="flex max-h-48 flex-wrap gap-1 overflow-y-auto">
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
    <p v-else class="py-4 text-center text-sm text-neutral-500">Antrian kosong</p>
  </section>
</template>
