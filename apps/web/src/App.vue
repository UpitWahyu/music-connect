<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import { store, refreshDevices, startPolling, stopPolling, logout } from "./composables/useMusic";
import Login from "./components/Login.vue";
import DeviceSelector from "./components/DeviceSelector.vue";
import Search from "./components/Search.vue";
import PlaylistPlay from "./components/PlaylistPlay.vue";
import Player from "./components/Player.vue";
import Queue from "./components/Queue.vue";
import Playlists from "./components/Playlists.vue";
import Favorites from "./components/Favorites.vue";
import History from "./components/History.vue";

type Tab = "search" | "playlists" | "favorites" | "history";
const tab = ref<Tab>("search");

const tabs: Array<{ id: Tab; label: string }> = [
  { id: "search", label: "🔎 Cari" },
  { id: "playlists", label: "📂 Playlist" },
  { id: "favorites", label: "❤️ Fav" },
  { id: "history", label: "🕘 Riwayat" },
];

onMounted(() => {
  if (store.authed) {
    void refreshDevices();
    startPolling();
  }
});
onUnmounted(stopPolling);
</script>

<template>
  <Login v-if="!store.authed" />

  <div v-else class="mx-auto max-w-md px-4 py-6">
    <header class="mb-4 flex items-center justify-between">
      <h1 class="text-xl font-bold">🎵 Music Connect</h1>
      <div class="flex items-center gap-3">
        <DeviceSelector />
        <button class="text-xs text-gray-400 hover:text-white" @click="logout">Logout</button>
      </div>
    </header>

    <nav v-if="store.selectedDevice" class="mb-4 flex gap-1 rounded-xl bg-gray-800 p-1 text-sm">
      <button
        v-for="t in tabs"
        :key="t.id"
        class="flex-1 rounded-lg px-2 py-1.5"
        :class="tab === t.id ? 'bg-gray-600 font-semibold' : 'text-gray-400 hover:text-white'"
        @click="tab = t.id"
      >
        {{ t.label }}
      </button>
    </nav>

    <div v-if="store.selectedDevice">
      <Search v-if="tab === 'search'" />
      <PlaylistPlay v-if="tab === 'search'" />
      <Playlists v-if="tab === 'playlists'" />
      <Favorites v-if="tab === 'favorites'" />
      <History v-if="tab === 'history'" />
      <Player />
      <Queue />
    </div>
    <p v-else class="mt-16 text-center text-sm text-gray-400">
      Select a device to start listening
    </p>
  </div>
</template>
