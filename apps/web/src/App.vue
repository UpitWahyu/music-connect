<script setup lang="ts">
import { ref } from "vue";
import DeviceSelector from "./components/DeviceSelector.vue";
import Search from "./components/Search.vue";
import Player from "./components/Player.vue";
import Queue from "./components/Queue.vue";

const selectedDevice = ref<string | null>(null);
</script>

<template>
  <div class="mx-auto max-w-md px-4 py-6">
    <header class="mb-4 flex items-center justify-between">
      <h1 class="text-xl font-bold">🎵 Music Connect</h1>
      <DeviceSelector v-model="selectedDevice" />
    </header>

    <div v-if="selectedDevice">
      <Search :device-id="selectedDevice" />
      <Player :device-id="selectedDevice" />
      <Queue :device-id="selectedDevice" />
    </div>
    <p v-else class="mt-16 text-center text-sm text-gray-400">
      Select a device to start listening
    </p>
  </div>
</template>
