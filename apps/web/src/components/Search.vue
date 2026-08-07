<script setup lang="ts">
import { ref } from "vue";

defineProps<{ deviceId: string }>();

interface SearchResult {
  id: string;
  title: string;
  artist: string;
}

const query = ref("");
const results = ref<SearchResult[]>([]);

function doSearch(): void {
  // TODO Phase 5: GET /api/music/search?q=... (youtubei.js provider, D-09 cache)
  results.value = [{ id: "xxx", title: "Blinding Lights", artist: "The Weeknd" }];
}

function addToQueue(): void {
  // TODO Phase 6: POST /api/devices/:id/queue
}
</script>

<template>
  <section class="mb-4">
    <form class="flex gap-2" @submit.prevent="doSearch">
      <input
        v-model="query"
        type="search"
        placeholder="🔎 Search YouTube Music"
        class="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm outline-none focus:border-green-500"
      />
    </form>

    <ul v-if="results.length" class="mt-2 divide-y divide-gray-800 rounded-lg border border-gray-800 bg-gray-900">
      <li
        v-for="r in results"
        :key="r.id"
        class="flex items-center justify-between px-3 py-2 text-sm"
      >
        <div>
          <div class="font-medium">{{ r.title }}</div>
          <div class="text-xs text-gray-400">{{ r.artist }}</div>
        </div>
        <button
          class="rounded bg-gray-700 px-2 py-1 text-xs hover:bg-gray-600"
          @click="addToQueue"
        >
          +
        </button>
      </li>
    </ul>
  </section>
</template>
