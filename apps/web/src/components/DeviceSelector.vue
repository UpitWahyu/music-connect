<script setup lang="ts">
import { computed, onMounted } from "vue";
import { store, refreshDevices, selectDeviceAuto } from "../composables/useMusic";

onMounted(() => {
  void refreshDevices();
});

const selected = computed({
  get: () => store.selectedDevice ?? "",
  set: (v: string) => {
    if (v && v !== store.selectedDevice) void selectDeviceAuto(v);
  },
});

const selectedOnline = computed(() => {
  const d = store.devices.find((x) => x.id === store.selectedDevice);
  return d?.online ?? false;
});
</script>

<template>
  <div class="flex items-center gap-2 rounded-lg border border-white/5 bg-[#14141c] px-2 py-1.5">
    <span
      class="h-2 w-2 shrink-0 rounded-full transition-colors"
      :class="selectedOnline ? 'bg-green-500' : 'bg-neutral-600'"
      :title="selectedOnline ? 'Online' : 'Offline'"
    ></span>
    <select
      v-model="selected"
      class="max-w-[10rem] bg-transparent text-sm outline-none"
    >
      <option value="" disabled>Pilih device…</option>
      <option v-for="d in store.devices" :key="d.id" :value="d.id">
        {{ d.name || d.id }}
      </option>
    </select>
  </div>
</template>
