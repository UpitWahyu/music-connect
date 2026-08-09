<script setup lang="ts">
import { computed } from "vue";
import { Music2, Sparkles } from "lucide-vue-next";
import { store } from "../composables/useMusic";
import { formatDuration } from "../lib/format";

const playingIndex = computed(() => store.playback?.queueIndex ?? 0);
</script>

<template>
  <section class="rounded-2xl border border-white/5 bg-[#14141c] p-4">
    <h2 class="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-400">Antrian</h2>
    <ul v-if="store.queue.length" class="divide-y divide-white/5">
      <li
        v-for="(item, i) in store.queue"
        :key="item.id"
        class="flex items-center gap-3 py-2 text-sm"
        :class="{ 'text-green-400': i === playingIndex }"
      >
        <span class="w-5 shrink-0 text-right text-xs text-neutral-600">
          {{ i + 1 }}
        </span>
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-1.5">
            <Music2 v-if="i === playingIndex" :size="12" class="shrink-0 text-green-400" />
            <span class="truncate font-medium">{{ item.track.title }}</span>
          </div>
          <div class="truncate text-xs text-neutral-500">{{ item.track.artist }}</div>
        </div>
        <span v-if="item.addedBy === 'auto'" class="flex shrink-0 items-center gap-1 rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-neutral-400" title="Rekomendasi otomatis">
          <Sparkles :size="9" />
          auto
        </span>
        <span class="shrink-0 text-xs text-neutral-600">{{ formatDuration(item.track.duration) }}</span>
      </li>
    </ul>
    <p v-else class="py-4 text-center text-sm text-neutral-500">Antrian kosong</p>
  </section>
</template>
