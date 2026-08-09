<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { ChevronDown, ChevronUp, Wifi, WifiOff } from "lucide-vue-next";
import { store, refreshDevices, selectDeviceAuto } from "../composables/useMusic";

const open = ref(false);

const selectedOnline = computed(
  () => store.devices.find((d) => d.id === store.selectedDevice)?.online ?? false,
);

const selectedName = computed(() => {
  const d = store.devices.find((x) => x.id === store.selectedDevice);
  return d ? d.name || d.id : "Pilih device…";
});

function toggle(): void {
  open.value = !open.value;
}

function pick(id: string): void {
  open.value = false;
  if (id !== store.selectedDevice) void selectDeviceAuto(id);
}

function onClickOutside(): void {
  open.value = false;
}

onMounted(() => {
  void refreshDevices();
  document.addEventListener("click", onClickOutside);
});
onBeforeUnmount(() => document.removeEventListener("click", onClickOutside));
</script>

<template>
  <div class="relative">
    <button
      class="flex w-full items-center gap-2 rounded-xl border border-white/5 bg-[#14141c] px-3 py-2 text-sm transition hover:border-white/10"
      @click.stop="toggle"
    >
      <span
        class="h-2 w-2 shrink-0 rounded-full transition-colors"
        :class="selectedOnline ? 'bg-green-500' : 'bg-neutral-600'"
      ></span>
      <span class="max-w-[9rem] flex-1 truncate text-left">{{ selectedName }}</span>
      <ChevronDown v-if="!open" :size="14" class="shrink-0 text-neutral-500" />
      <ChevronUp v-else :size="14" class="shrink-0 text-neutral-500" />
    </button>

    <!-- custom dropdown (opens upward) -->
    <div
      v-if="open"
      class="absolute bottom-full left-0 z-[70] mb-2 w-60 overflow-hidden rounded-xl border border-white/10 bg-[#1c1c26] shadow-2xl shadow-black/60"
    >
      <div v-if="store.devices.length" class="max-h-64 overflow-y-auto py-1">
        <button
          v-for="d in store.devices"
          :key="d.id"
          class="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-sm transition hover:bg-white/5"
          :class="d.id === store.selectedDevice ? 'text-green-400' : 'text-neutral-200'"
          @click.stop="pick(d.id)"
        >
          <span
            class="h-2 w-2 shrink-0 rounded-full"
            :class="d.online ? 'bg-green-500' : 'bg-neutral-600'"
          ></span>
          <span class="min-w-0 flex-1 truncate">{{ d.name || d.id }}</span>
          <Wifi v-if="d.online" :size="13" class="shrink-0 text-green-500/60" />
          <WifiOff v-else :size="13" class="shrink-0 text-neutral-600" />
        </button>
      </div>
      <p v-else class="px-3 py-3 text-center text-xs text-neutral-500">Belum ada device — jalankan player dulu</p>
    </div>
  </div>
</template>
