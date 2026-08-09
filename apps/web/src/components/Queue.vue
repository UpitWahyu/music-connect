<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { ListMusic, Music2, Play, Sparkles } from "lucide-vue-next";
import { api } from "../lib/api";
import { store, refreshQueue, refreshState } from "../composables/useMusic";
import { formatDuration } from "../lib/format";

const playingIndex = computed(() => store.playback?.queueIndex ?? 0);

// --- play item ---
async function playItem(itemId: string): Promise<void> {
  if (!store.selectedDevice) return;
  try {
    await api.playQueueItem(store.selectedDevice, itemId);
    await refreshState();
  } catch {
    // player offline etc
  }
}

// --- sort (commits a new order via reorder API) ---
const sort = ref<"default" | "title" | "artist" | "duration">("default");
let baseOrder: string[] = [];

onMounted(() => {
  baseOrder = store.queue.map((i) => i.id);
});

async function changeSort(): Promise<void> {
  if (!store.selectedDevice || !store.queue.length) return;
  const q = [...store.queue];
  if (sort.value === "title") q.sort((a, b) => a.track.title.localeCompare(b.track.title));
  else if (sort.value === "artist") q.sort((a, b) => a.track.artist.localeCompare(b.track.artist));
  else if (sort.value === "duration") q.sort((a, b) => (a.track.duration || 0) - (b.track.duration || 0));
  else if (baseOrder.length === q.length) {
    // back to the original order captured on mount
    const byId = new Map(q.map((i) => [i.id, i]));
    const restored: typeof q = [];
    for (const id of baseOrder) {
      const it = byId.get(id);
      if (it) restored.push(it);
    }
    q.splice(0, q.length, ...restored);
  }
  try {
    await api.reorderQueue(store.selectedDevice, q.map((i) => i.id));
    await refreshQueue();
  } catch {
    // order mismatch etc
  }
}
</script>

<template>
  <section class="rounded-2xl border border-white/5 bg-[#14141c] p-4">
    <div class="mb-2 flex items-center justify-between">
      <h2 class="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-neutral-400">
        <ListMusic :size="14" />
        Antrian
        <span class="text-neutral-600">({{ store.queue.length }})</span>
      </h2>
      <select
        v-model="sort"
        class="rounded-lg border border-white/5 bg-black/30 px-2 py-1 text-xs outline-none"
        title="Urutkan antrian"
        @change="changeSort"
      >
        <option value="default">Urutan asli</option>
        <option value="title">Judul A–Z</option>
        <option value="artist">Artis A–Z</option>
        <option value="duration">Durasi</option>
      </select>
    </div>

    <ul v-if="store.queue.length" class="divide-y divide-white/5">
      <li
        v-for="(item, i) in store.queue"
        :key="item.id"
        class="group flex items-center gap-3 py-2 text-sm transition hover:bg-white/5"
      >
        <button
          class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition"
          :class="i === playingIndex ? 'bg-green-500 text-black' : 'bg-white/10 text-neutral-300 hover:bg-green-500 hover:text-black'"
          :title="i === playingIndex ? 'Sedang diputar — klik untuk ulang' : 'Putar sekarang'"
          @click="playItem(item.id)"
        >
          <Play v-if="i !== playingIndex" :size="12" class="ml-0.5" />
          <Music2 v-else :size="12" />
        </button>
        <div class="min-w-0 flex-1">
          <div class="truncate font-medium" :class="{ 'text-green-400': i === playingIndex }">
            {{ item.track.title }}
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
