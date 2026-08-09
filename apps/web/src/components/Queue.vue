<script setup lang="ts">
import { computed, ref } from "vue";
import { ListMusic, Music2, Play, Sparkles, Heart, FolderPlus } from "lucide-vue-next";
import { api, type QueueItemDTO } from "../lib/api";
import { store, refreshQueue, refreshState, refreshPlaylists, refreshFavorites } from "../composables/useMusic";
import { formatDuration } from "../lib/format";

// --- drag & drop reorder (native HTML5; optimistic + server commit) ---
const dragId = ref<string | null>(null);
const dragOverId = ref<string | null>(null);

function onDragStart(itemId: string, e: DragEvent): void {
  dragId.value = itemId;
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", itemId);
  }
}

function onDragOver(itemId: string, e: DragEvent): void {
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
  if (dragOverId.value !== itemId) dragOverId.value = itemId;
}

function onDragEnd(): void {
  dragId.value = null;
  dragOverId.value = null;
}

async function onDrop(itemId: string, e: DragEvent): Promise<void> {
  e.preventDefault(); // stop the browser from navigating on drop
  const from = dragId.value;
  const to = itemId;
  dragId.value = null;
  dragOverId.value = null;
  if (!from || from === to) return;
  const arr = [...store.queue];
  const i = arr.findIndex((x) => x.id === from);
  const j = arr.findIndex((x) => x.id === to);
  if (i < 0 || j < 0 || !store.selectedDevice) return;
  const [moved] = arr.splice(i, 1);
  arr.splice(j, 0, moved);
  store.queue = arr; // optimistic UI
  try {
    await api.reorderQueue(store.selectedDevice, arr.map((x) => x.id));
  } catch {
    // server rejected — refetch authoritative order
  }
  void refreshQueue();
}

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
function isFav(trackId: string): boolean {
  return store.favorites.some((f) => f.trackId === trackId);
}

async function toggleFavorite(item: QueueItemDTO): Promise<void> {
  if (isFav(item.track.id)) await api.removeFavorite(item.track.id).catch(() => null);
  else await api.addFavorite(item.track).catch(() => null);
  await refreshFavorites();
}

const saveFor = ref<QueueItemDTO | null>(null);
const containsMap = ref<Record<string, boolean>>({});

async function openPlaylistPicker(item: QueueItemDTO): Promise<void> {
  saveFor.value = saveFor.value?.id === item.id ? null : item;
  if (saveFor.value) {
    const r = await api.playlistsWithTrack(item.track.id).catch(() => null);
    containsMap.value = Object.fromEntries((r?.playlists ?? []).map((p) => [p.id, p.contains]));
  }
}

/** Toggle: add to the playlist, or remove when already contained. */
async function togglePlaylist(playlistId: string): Promise<void> {
  if (!saveFor.value) return;
  if (containsMap.value[playlistId]) {
    await api.removeFromPlaylist(playlistId, saveFor.value.track.id).catch(() => null);
  } else {
    await api.addToPlaylist(playlistId, saveFor.value.track).catch(() => null);
  }
  containsMap.value = { ...containsMap.value, [playlistId]: !containsMap.value[playlistId] };
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
        class="relative flex cursor-grab items-center gap-3 py-2 text-sm transition active:cursor-grabbing"
        :class="dragOverId === item.id ? 'rounded-lg bg-white/5 ring-1 ring-green-500/60' : 'hover:bg-white/5'"
        draggable="true"
        @dragstart="onDragStart(item.id, $event)"
        @dragover="onDragOver(item.id, $event)"
        @dragend="onDragEnd"
        @drop="onDrop(item.id)"
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
            class="rounded-lg p-1.5 transition"
            :class="isFav(item.track.id) ? 'text-red-500' : 'text-neutral-500 hover:bg-white/10 hover:text-red-400'"
            :title="isFav(item.track.id) ? 'Hapus dari favorit' : 'Tambah ke favorit'"
            @click="toggleFavorite(item)"
          >
            <Heart :size="13" :fill="isFav(item.track.id) ? 'currentColor' : 'none'" />
          </button>
          <button
            class="rounded-lg p-1.5 text-neutral-500 transition hover:bg-white/10 hover:text-white"
            :title="saveFor?.id === item.id ? 'Tutup' : 'Simpan ke playlist'"
            @click="openPlaylistPicker(item)"
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
              class="rounded-lg px-2.5 py-1.5 text-xs font-medium transition"
              :class="containsMap[p.id] ? 'bg-green-500 text-black' : 'bg-white/10 hover:bg-green-500 hover:text-black'"
              :title="containsMap[p.id] ? 'Hapus dari playlist' : 'Tambah ke playlist'"
              @click="togglePlaylist(p.id)"
            >
              {{ p.name }}{{ containsMap[p.id] ? " ✓" : "" }}
            </button>
          </div>
          <p v-else class="text-xs text-neutral-500">Belum ada playlist — buat di tab Playlist</p>
        </div>
      </li>
    </ul>
    <p v-else class="py-4 text-center text-sm text-neutral-500">Antrian kosong</p>
  </section>
</template>
