<script setup lang="ts">
import { onMounted } from "vue";
import { store, refreshDevices, selectDevice } from "../composables/useMusic";

onMounted(() => {
  void refreshDevices();
});

function onChange(): void {
  if (store.selectedDevice) void selectDevice(store.selectedDevice);
}
</script>

<template>
  <select
    :value="store.selectedDevice ?? undefined"
    class="rounded-lg border border-gray-700 bg-gray-800 px-2 py-1 text-sm"
    @change="onChange"
  >
    <option :value="undefined" disabled>Select a device</option>
    <option v-for="d in store.devices" :key="d.id" :value="d.id">
      {{ d.name || d.id }} {{ d.online ? "🟢" : "⚪" }}
    </option>
  </select>
</template>
