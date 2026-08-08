<script setup lang="ts">
import { onMounted, onUnmounted } from "vue";
import { store, refreshDevices, startPolling, stopPolling, logout } from "./composables/useMusic";
import Login from "./components/Login.vue";
import DeviceSelector from "./components/DeviceSelector.vue";
import Search from "./components/Search.vue";
import PlaylistPlay from "./components/PlaylistPlay.vue";
import Player from "./components/Player.vue";
import Queue from "./components/Queue.vue";

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

    <div v-if="store.selectedDevice">
      <Search />
      <PlaylistPlay />
      <Player />
      <Queue />
    </div>
    <p v-else class="mt-16 text-center text-sm text-gray-400">
      Select a device to start listening
    </p>
  </div>
</template>
