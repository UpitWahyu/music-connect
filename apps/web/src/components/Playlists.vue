<script setup lang="ts">
import { ref } from "vue";
import { api, type PlaylistTrackDTO } from "../lib/api";
import { store, refreshPlaylists, refreshQueue, refreshState } from "../composables/useMusic";
import { formatDuration } from "../lib/format";

const name = ref("");
const busy = ref(false);
const msg = ref("");
const openId = ref<string | null>(null);
const detail = ref<{ id: string; name: string; tracks: PlaylistTrackDTO[] } | null>(null);

async function create(): Promise<void> {
  if (!name.value.trim()) return;
  busy.value = true;
  msg.value = "";
  try {
    await api.createPlaylist(name.value.trim());
    name.value = "";
    msg.value = "✅ Playlist dibuat";
    await refreshPlaylists();
  } catch (e) {
    msg.value = `❌ ${(e as Error).message}`;
  } finally {
    busy.value = false;
  }
}

async function toggle(id: string): Promise<void> {
  if (openId.value === id) {
    openId.value = null;
    detail.value = null;
    return;
  }
  openId.value = id;
  detail.value = (await api.playlistDetail(id)).playlist;
}

async function playPlaylist(id: string): Promise<void> {
  if (!store.selectedDevice) return;
  try {
    await api.playLocalPlaylist(id, store.selectedDevice);
    await refreshQueue();
    await refreshState();
  } catch {
    /* offline etc */
  }
}

async function removePlaylist(id: string): Promise<void> {
  await api.deletePlaylist(id);
  if (openId.value === id) {
    openId.value = null;
    detail.value = null;
  }
  await refreshPlaylists();
}

async function removeTrack(trackId: string): Promise<void> {
  if (!openId.value) return;
  await api.removeFromPlaylist(openId.value, trackId);
  detail.value = (await api.playlistDetail(openId.value)).playlist;
  await refreshPlaylists();
}
</script>

<template>
  <section class="mb-4 rounded-2xl border border-gray-700 bg-gray-800 p-4">
    <h2 class="mb-2 text-sm font-semibold text-gray-300">📂 My Playlists</h2>

    <div class="mb-3 flex gap-2">
      <input
        v-model="name"
        placeholder="Nama playlist baru"
        class="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm outline-none focus:border-green-500"
        @keyup.enter="create"
      />
      <button
        :disabled="busy || !name.trim()"
        class="shrink-0 rounded-lg bg-gray-600 px-3 text-sm hover:bg-gray-500 disabled:opacity-50"
        @click="create"
      >
        + Buat
      </button>
    </div>
    <p v-if="msg" class="mb-2 text-xs text-gray-400">{{ msg }}</p>

    <ul v-if="store.playlists.length" class="divide-y divide-gray-800">
      <li v-for="p in store.playlists" :key="p.id" class="py-2">
        <div class="flex items-center justify-between gap-2 text-sm">
          <button class="min-w-0 flex-1 truncate text-left font-medium hover:text-green-400" @click="toggle(p.id)">
            {{ p.name }} <span class="text-xs text-gray-500">({{ p._count.tracks }})</span>
          </button>
          <button
            class="rounded bg-green-600/80 px-2 py-1 text-xs hover:bg-green-500"
            title="Putar di device"
            @click="playPlaylist(p.id)"
          >
            ▶
          </button>
          <button class="px-1 text-xs text-gray-500 hover:text-red-400" title="Hapus playlist" @click="removePlaylist(p.id)">
            🗑
          </button>
        </div>

        <ul v-if="openId === p.id && detail" class="mt-2 divide-y divide-gray-800/60 rounded-lg bg-gray-900 px-3">
          <li v-for="t in detail.tracks" :key="t.trackId" class="flex items-center justify-between gap-2 py-1.5 text-sm">
            <div class="min-w-0 flex-1">
              <div class="truncate">{{ t.title }}</div>
              <div class="truncate text-xs text-gray-500">{{ t.artist }} · {{ formatDuration(t.duration) }}</div>
            </div>
            <button class="shrink-0 px-1 text-xs text-gray-500 hover:text-red-400" @click="removeTrack(t.trackId)">✕</button>
          </li>
          <li v-if="!detail.tracks.length" class="py-2 text-center text-xs text-gray-500">Kosong — tambah lagu dari Search</li>
        </ul>
      </li>
    </ul>
    <p v-else class="py-3 text-center text-sm text-gray-500">Belum ada playlist. Buat satu, lalu simpan lagu dari Search.</p>
  </section>
</template>
