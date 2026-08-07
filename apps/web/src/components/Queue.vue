<script setup lang="ts">
import { ref } from "vue";

defineProps<{ deviceId: string }>();

interface QueueEntry {
  id: string;
  title: string;
  artist: string;
}

const queue = ref<QueueEntry[]>([]);

// TODO Phase 6: fetch GET /api/devices/:id/queue + subscribe to queue.updated
</script>

<template>
  <section class="rounded-2xl border border-gray-700 bg-gray-800 p-4">
    <h2 class="mb-2 text-sm font-semibold text-gray-300">Queue</h2>
    <ul v-if="queue.length" class="divide-y divide-gray-800">
      <li
        v-for="(item, i) in queue"
        :key="item.id"
        class="flex items-center justify-between py-2 text-sm"
      >
        <span class="text-xs text-gray-500">{{ i + 1 }}</span>
        <div class="flex-1 px-2">
          <div class="font-medium">{{ item.title }}</div>
          <div class="text-xs text-gray-400">{{ item.artist }}</div>
        </div>
        <button class="text-xs text-gray-400 hover:text-white">✕</button>
      </li>
    </ul>
    <p v-else class="py-4 text-center text-sm text-gray-500">Queue is empty</p>
  </section>
</template>
