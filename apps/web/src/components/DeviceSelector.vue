<script setup lang="ts">
import { computed, onMounted } from "vue";
import { store, refreshDevices, selectDevice } from "../composables/useMusic";

onMounted(() => {
  void refreshDevices();
});

// v-model backed by the store: picking a device sets store.selectedDevice
// and triggers refreshAll (queue + playback state).
const selected = computed({
  get: () => store.selectedDevice ?? "",
  set: (v: string) => {
    if (v) void selectDevice(v);
  },
});
</script>

<template>
  <select
    v-model="selected"
    class="rounded-lg border border-gray-700 bg-gray-800 px-2 py-1 text-sm"
  >
    <option value="" disabled>Select a device</option>
    <option v-for="d in store.devices" :key="d.id" :value="d.id">
      {{ d.name || d.id }} {{ d.online ? "🟢" : "⚪" }}
    </option>
  </select>
</template>
