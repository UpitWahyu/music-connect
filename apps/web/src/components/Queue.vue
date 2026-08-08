<script setup lang="ts">
import { computed } from "vue";
import { store } from "../composables/useMusic";
import { formatDuration } from "../lib/format";

const playingIndex = computed(() => store.playback?.queueIndex ?? 0);
</script>

<template>
  <section class="rounded-2xl border border-gray-700 bg-gray-800 p-4">
    <h2 class="mb-2 text-sm font-semibold text-gray-300">Queue</h2>
    <ul v-if="store.queue.length" class="divide-y divide-gray-800">
      <li
        v-for="(item, i) in store.queue"
        :key="item.id"
        class="flex items-center justify-between gap-2 py-2 text-sm"
        :class="{ 'text-green-400': i === playingIndex }"
      >
        <span class="w-5 shrink-0 text-xs text-gray-500">{{ i + 1 }}</span>
        <div class="min-w-0 flex-1">
          <div class="truncate font-medium">
            {{ item.track.title }}
            <span v-if="i === playingIndex" class="text-green-400">▶</span>
          </div>
          <div class="truncate text-xs text-gray-400">{{ item.track.artist }}</div>
        </div>
        <span class="shrink-0 text-xs text-gray-500">{{ formatDuration(item.track.duration) }}</span>
        <span
          v-if="item.addedBy === 'auto'"
          class="shrink-0 rounded bg-gray-700 px-1.5 py-0.5 text-[10px] text-gray-400"
          title="Rekomendasi otomatis"
        >
          auto
        </span>
      </li>
    </ul>
    <p v-else class="py-4 text-center text-sm text-gray-500">Queue is empty</p>
  </section>
</template>
