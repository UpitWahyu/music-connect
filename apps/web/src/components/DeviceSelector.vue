<script setup lang="ts">
import { ref } from "vue";

const model = defineModel<string | null>();
const devices = ref<string[]>(["living-room", "bedroom", "desktop"]);
const online = ref<Record<string, boolean>>({ "living-room": true });

// TODO Phase 4: fetch GET /api/devices + live online/offline via WS events
</script>

<template>
  <label class="flex items-center gap-2 text-sm">
    <span class="text-gray-400">Playing on</span>
    <select
      v-model="model"
      class="rounded-lg border border-gray-700 bg-gray-800 px-2 py-1 text-sm"
    >
      <option :value="null" disabled>Select a device</option>
      <option v-for="d in devices" :key="d" :value="d">
        {{ d }} {{ online[d] ? "🟢" : "⚪" }}
      </option>
    </select>
  </label>
</template>
