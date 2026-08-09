<script setup lang="ts">
import { onMounted, ref } from "vue";
import { Clock, Play, Trash2 } from "lucide-vue-next";
import { api, type HistoryDTO } from "../lib/api";
import { store, refreshState } from "../composables/useMusic";
import { t, i18n } from "../i18n";

const history = ref<HistoryDTO[]>([]);

async function load(): Promise<void> {
  history.value = (await api.history()).history;
}

async function playTrack(trackId: string, title: string, artist: string): Promise<void> {
  if (!store.selectedDevice) return;
  await api.play(store.selectedDevice, trackId, {
    id: trackId,
    provider: "youtube-music",
    title,
    artist,
    duration: 0,
  });
  await refreshState();
}

async function clearAll(): Promise<void> {
  await api.clearHistory();
  await load();
}

onMounted(load);
</script>

<template>
  <section class="rounded-2xl border border-white/5 bg-[#14141c] p-4">
    <div class="mb-2 flex items-center justify-between">
      <h2 class="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-neutral-400">
        <Clock :size="14" />
        {{ t("historyTitle") }}
      </h2>
      <button
        v-if="history.length"
        class="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-neutral-500 transition hover:bg-white/10 hover:text-red-400"
        :title="t('clearAllTitle')"
        @click="clearAll"
      >
        <Trash2 :size="12" />
        {{ t("clearAll") }}
      </button>
    </div>
    <ul v-if="history.length" class="divide-y divide-white/5">
      <li v-for="h in history" :key="h.id" class="flex items-center gap-3 py-2 text-sm">
        <div class="min-w-0 flex-1">
          <div class="truncate font-medium">{{ h.title }}</div>
          <div class="truncate text-xs text-neutral-500">
            {{ h.artist }} · {{ new Date(h.playedAt).toLocaleString(i18n.lang === "id" ? "id-ID" : "en-US", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) }}
          </div>
        </div>
        <button
          class="rounded-lg bg-green-500/90 p-1.5 text-black transition hover:bg-green-400"
          @click="playTrack(h.trackId, h.title, h.artist)"
        >
          <Play :size="13" />
        </button>
      </li>
    </ul>
    <p v-else class="py-3 text-center text-sm text-neutral-500">
      {{ t("historyEmpty") }}
    </p>
  </section>
</template>
