<script setup lang="ts">
import { ref } from "vue";
import { FolderOpen, Play, Trash2, X } from "lucide-vue-next";
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
    msg.value = "Playlist dibuat";
    await refreshPlaylists();
  } catch (e) {
    msg.value = `Gagal: ${(e as Error).message}`;
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
    // offline etc
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
  <section class="mb-4 rounded-2xl border border-white/5 bg-[#14141c] p-4">
    <h2 class="mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-neutral-400">
      <FolderOpen :size="14" />
      Playlist Saya
    </h2>

    <div class="mb-3 flex gap-2">
      <input
        v-model="name"
        placeholder="Nama playlist baru…"
        class="w-full rounded-lg border border-white/5 bg-black/30 px-3 py-2 text-sm outline-none placeholder:text-neutral-600 focus:border-green-500/40"
        @keyup.enter="create"
      />
      <button
        :disabled="busy || !name.trim()"
        class="shrink-0 rounded-lg bg-white/10 px-3 text-sm font-medium transition hover:bg-white/15 disabled:opacity-50"
        @click="create"
      >
        + Buat
      </button>
    </div>
    <p v-if="msg" class="mb-2 text-xs text-neutral-400">{{ msg }}</p>

    <ul v-if="store.playlists.length" class="divide-y divide-white/5">
      <li v-for="p in store.playlists" :key="p.id" class="py-2">
        <div class="flex items-center justify-between gap-2 text-sm">
          <button class="min-w-0 flex-1 truncate text-left font-medium transition hover:text-green-400" @click="toggle(p.id)">
            {{ p.name }}
            <span class="text-xs text-neutral-500">({{ p._count.tracks }})</span>
          </button>
          <button
            class="rounded-lg bg-green-500/90 p-1.5 text-black transition hover:bg-green-400"
            title="Putar"
            @click="playPlaylist(p.id)"
          >
            <Play :size="13" />
          </button>
          <button
            class="rounded-lg p-1.5 text-neutral-500 transition hover:bg-white/10 hover:text-red-400"
            title="Hapus playlist"
            @click="removePlaylist(p.id)"
          >
            <Trash2 :size="13" />
          </button>
        </div>

        <ul v-if="openId === p.id && detail" class="mt-2 divide-y divide-white/5 rounded-lg bg-black/30 px-3">
          <li v-for="t in detail.tracks" :key="t.trackId" class="flex items-center justify-between gap-2 py-1.5 text-sm">
            <div class="min-w-0 flex-1">
              <div class="truncate">{{ t.title }}</div>
              <div class="truncate text-xs text-neutral-500">
                {{ t.artist }} · {{ formatDuration(t.duration) }}
              </div>
            </div>
            <button class="shrink-0 rounded p-1 text-neutral-500 transition hover:bg-white/10 hover:text-red-400" @click="removeTrack(t.trackId)">
              <X :size="13" />
            </button>
          </li>
          <li v-if="!detail.tracks.length" class="py-2 text-center text-xs text-neutral-500">
            Kosong — tambah lagu dari tab Cari
          </li>
        </ul>
      </li>
    </ul>
    <p v-else class="py-3 text-center text-sm text-neutral-500">
      Belum ada playlist. Buat satu, lalu simpan lagu dari pencarian.
    </p>
  </section>
</template>
