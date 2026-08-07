<script setup lang="ts">
import { ref } from "vue";

const props = defineProps<{ deviceId: string }>();

const playing = ref(false);
const title = ref("Nothing playing");
const artist = ref("—");
const position = ref("0:00");
const duration = ref("0:00");
const volume = ref(70);

// TODO Phase 4: subscribe to WS player.state for this device (D-06 interpolation)
// TODO Phase 4: buttons → POST /api/devices/:id/{play,pause,next,previous,seek,volume}
</script>

<template>
  <section class="mb-4 rounded-2xl border border-gray-700 bg-gray-800 p-4">
    <div class="mb-3 text-center">
      <div class="text-sm font-semibold text-gray-400">🎵 Playing on {{ props.deviceId }}</div>
      <div class="mt-2 text-lg font-bold">{{ title }}</div>
      <div class="text-sm text-gray-400">{{ artist }}</div>
    </div>

    <div class="mb-2 text-center text-xs text-gray-500">{{ position }} / {{ duration }}</div>
    <div class="mb-4 h-1 rounded bg-gray-700">
      <div class="h-1 w-1/3 rounded bg-green-500"></div>
    </div>

    <div class="flex items-center justify-center gap-6 text-2xl">
      <button class="text-gray-300 hover:text-white">⏮</button>
      <button
        class="rounded-full bg-green-500 px-6 py-2 text-black hover:bg-green-400"
        @click="playing = !playing"
      >
        {{ playing ? "❚❚" : "▶" }}
      </button>
      <button class="text-gray-300 hover:text-white">⏭</button>
    </div>

    <div class="mt-4 flex items-center gap-2 text-sm">
      <span>🔊</span>
      <input v-model.number="volume" type="range" min="0" max="100" class="w-full accent-green-500" />
    </div>
  </section>
</template>
