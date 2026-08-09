<script setup lang="ts">
import { ref } from "vue";
import { Search as SearchIcon, Play, Plus, Heart, FolderPlus, X, Link2 } from "lucide-vue-next";
import { api, type TrackDTO } from "../lib/api";
import { store, refreshQueue, refreshState, refreshPlaylists } from "../composables/useMusic";
import { showToast } from "../composables/useToast";
import { formatDuration } from "../lib/format";

// --- modal visibility ---
const showSearch = ref(false);
const showLink = ref(false);

// --- search state ---
const query = ref("");
const results = ref<TrackDTO[]>([]);
const busy = ref(false);

async function doSearch(): Promise<void> {
  if (!query.value.trim()) return;
  busy.value = true;
  try {
    results.value = (await api.search(query.value)).tracks;
  } finally {
    busy.value = false;
  }
}

function resetSearch(): void {
  query.value = "";
  results.value = [];
}

function closeSearch(): void {
  showSearch.value = false;
  resetSearch();
}

// --- track actions ---
async function playNow(track: TrackDTO): Promise<void> {
  if (!store.selectedDevice) return;
  await api.play(store.selectedDevice, track.id, track);
  await refreshState();
}

async function addToQueue(track: TrackDTO): Promise<void> {
  if (!store.selectedDevice) return;
  await api.addToQueue(store.selectedDevice, track);
  await refreshQueue();
  showToast("Ditambahkan ke queue");
}

async function favorite(track: TrackDTO): Promise<void> {
  await api.addFavorite(track);
  showToast("Ditambahkan ke favorit");
}

const saveFor = ref<TrackDTO | null>(null);

/** Toggle playlist picker — refresh the list first (login may not have loaded it). */
async function toggleSaveFor(t: TrackDTO): Promise<void> {
  saveFor.value = saveFor.value?.id === t.id ? null : t;
  if (saveFor.value) await refreshPlaylists();
}

async function saveToPlaylist(playlistId: string): Promise<void> {
  if (!saveFor.value) return;
  const plName = store.playlists.find((p) => p.id === playlistId)?.name ?? "playlist";
  await api.addToPlaylist(playlistId, saveFor.value);
  saveFor.value = null;
  await refreshPlaylists();
  showToast(`Ditambahkan ke ${plName}`);
}

// --- playlist link modal ---
const linkUrl = ref("");
const linkBusy = ref(false);
const linkError = ref("");

function parseListId(url: string): string | null {
  const m = url.match(/[?&]list=([A-Za-z0-9_-]{10,})/);
  return m?.[1] ?? null;
}

async function playLink(): Promise<void> {
  linkError.value = "";
  if (!store.selectedDevice) {
    linkError.value = "Pilih device dulu di panel ⋯";
    return;
  }
  const listId = parseListId(linkUrl.value.trim());
  if (!listId) {
    linkError.value = "Link tidak valid — harus berisi ?list=… (YouTube/YouTube Music)";
    return;
  }
  linkBusy.value = true;
  try {
    const r = await api.playPlaylist(store.selectedDevice, listId);
    showLink.value = false;
    linkUrl.value = "";
    await refreshQueue();
    await refreshState();
    showToast(`${r.queued} lagu masuk queue`);
  } catch (e) {
    linkError.value = "Gagal memuat playlist: " + ((e as Error).message || "coba lagi");
  } finally {
    linkBusy.value = false;
  }
}
</script>

<template>
  <section class="space-y-4">
    <!-- clean launcher: two action cards -->
    <div class="grid grid-cols-2 gap-3">
      <button
        class="flex flex-col items-center gap-2.5 rounded-2xl border border-white/5 bg-[#14141c] py-6 transition hover:border-green-500/30 hover:bg-[#16161f]"
        @click="showSearch = true"
      >
        <span class="flex h-11 w-11 items-center justify-center rounded-xl bg-green-500/15 text-green-400">
          <SearchIcon :size="19" />
        </span>
        <span class="text-sm font-medium">Cari Lagu</span>
      </button>
      <button
        class="flex flex-col items-center gap-2.5 rounded-2xl border border-white/5 bg-[#14141c] py-6 transition hover:border-green-500/30 hover:bg-[#16161f]"
        @click="showLink = true"
      >
        <span class="flex h-11 w-11 items-center justify-center rounded-xl bg-white/10 text-neutral-300">
          <Link2 :size="19" />
        </span>
        <span class="text-sm font-medium">Playlist dari Link</span>
      </button>
    </div>

    <!-- ============ search modal ============ -->
    <div
      v-if="showSearch"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      @click.self="closeSearch"
    >
      <div
        class="flex max-h-[85vh] w-full max-w-md flex-col rounded-2xl border border-white/10 bg-[#16161f] shadow-2xl shadow-black/60"
      >
        <div class="flex items-center justify-between border-b border-white/5 p-4">
          <h3 class="flex items-center gap-2 text-sm font-semibold">
            <SearchIcon :size="15" class="text-green-400" />
            Cari Lagu
          </h3>
          <button type="button" class="rounded-lg p-1.5 text-neutral-400 transition hover:bg-white/10 hover:text-white" @click="closeSearch">
            <X :size="15" />
          </button>
        </div>

        <form class="flex gap-2 p-4 pb-2" @submit.prevent="doSearch">
          <div class="relative w-full">
            <SearchIcon :size="16" class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500" />
            <input
              v-model="query"
              type="search"
              placeholder="Lagu atau artis…"
              class="w-full rounded-xl border border-white/5 bg-[#14141c] py-2.5 pl-9 pr-8 text-sm outline-none placeholder:text-neutral-600 focus:border-green-500/40"
            />
            <button
              v-if="query"
              type="button"
              class="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-full p-0.5 text-neutral-500 transition hover:bg-white/10 hover:text-white"
              @click="resetSearch"
            >
              <X :size="13" />
            </button>
          </div>
          <button
            type="submit"
            :disabled="busy"
            class="rounded-xl bg-white/10 px-4 text-sm font-medium transition hover:bg-white/15 disabled:opacity-50"
          >
            {{ busy ? "…" : "Cari" }}
          </button>
        </form>

        <div class="flex-1 overflow-y-auto px-4 pb-4 pt-1">
          <ul v-if="results.length" class="divide-y divide-white/5">
            <li v-for="t in results" :key="t.id" class="relative flex items-center gap-3 py-2.5">
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
                  title="Tambah ke favorit"
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

              <!-- playlist picker -->
              <div
                v-if="saveFor?.id === t.id"
                class="absolute inset-x-3 bottom-full z-10 mb-1 rounded-xl border border-white/10 bg-[#1c1c26] p-2 shadow-2xl shadow-black/60"
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
          <p v-else class="py-10 text-center text-sm text-neutral-500">
            {{ busy ? "Mencari…" : query ? "Tidak ada hasil" : "Ketik judul lagu atau nama artis" }}
          </p>
        </div>
      </div>
    </div>

    <!-- ============ playlist link modal ============ -->
    <div
      v-if="showLink"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      @click.self="showLink = false"
    >
      <div class="w-full max-w-md rounded-2xl border border-white/10 bg-[#16161f] p-5 shadow-2xl shadow-black/60">
        <div class="mb-3 flex items-center justify-between">
          <h3 class="flex items-center gap-2 text-sm font-semibold">
            <Link2 :size="15" class="text-green-400" />
            Putar Playlist dari Link
          </h3>
          <button type="button" class="rounded-lg p-1.5 text-neutral-400 transition hover:bg-white/10 hover:text-white" @click="showLink = false">
            <X :size="15" />
          </button>
        </div>
        <input
          v-model="linkUrl"
          type="url"
          placeholder="https://music.youtube.com/playlist?list=…"
          class="w-full rounded-xl border border-white/5 bg-[#14141c] px-3 py-2.5 text-sm outline-none placeholder:text-neutral-600 focus:border-green-500/40"
          @keyup.enter="playLink"
        />
        <p v-if="linkError" class="mt-2 text-xs text-red-400">{{ linkError }}</p>
        <div class="mt-4 flex gap-2">
          <button
            class="flex-1 rounded-xl bg-green-500 px-4 py-2.5 text-sm font-semibold text-black transition hover:bg-green-400 disabled:opacity-50"
            :disabled="linkBusy || !linkUrl.trim()"
            @click="playLink"
          >
            {{ linkBusy ? "Memuat…" : "Mainkan" }}
          </button>
          <button type="button" class="rounded-xl bg-white/10 px-4 text-sm transition hover:bg-white/15" @click="showLink = false">
            Batal
          </button>
        </div>
      </div>
    </div>
  </section>
</template>
