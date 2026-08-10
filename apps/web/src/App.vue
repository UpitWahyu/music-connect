<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import { Music, Search as SearchIcon, FolderOpen, Heart, History as HistoryIcon, LogOut, CircleUser, Settings as SettingsIcon } from "lucide-vue-next";
import { store, refreshDevices, startRealtime, startPolling, stopPolling, logout, sendWsCommand } from "./composables/useMusic";
import { api } from "./lib/api";
import { t } from "./i18n";
import Login from "./components/Login.vue";
import Search from "./components/Search.vue";
import Player from "./components/Player.vue";
import Queue from "./components/Queue.vue";
import Playlists from "./components/Playlists.vue";
import Favorites from "./components/Favorites.vue";
import History from "./components/History.vue";
import Toast from "./components/Toast.vue";
import Settings from "./components/Settings.vue";

type Tab = "search" | "playlists" | "favorites" | "history";
const tab = ref<Tab>("search");

// --- user menu (top-right dropdown) ---
const menuOpen = ref(false);
const showSettings = ref(false);

function onClickOutside(): void {
  menuOpen.value = false;
}

function openSettings(): void {
  menuOpen.value = false;
  showSettings.value = true;
}

onMounted(() => {
  document.addEventListener("click", onClickOutside);
  window.addEventListener("keydown", onKeydown);
  if (store.authed) {
    void refreshDevices();
    // session restore (token in localStorage) skips login() — realtime WS must
    // still start, otherwise the UI falls back to slow 10s polling only
    startRealtime();
    startPolling();
  }
});

onUnmounted(() => {
  document.removeEventListener("click", onClickOutside);
  stopPolling();
  window.removeEventListener("keydown", onKeydown);
});

/** Global keyboard shortcuts: Space play/pause, ←/→ seek ±5s, ↑/↓ volume. */
function onKeydown(e: KeyboardEvent): void {
  if (!store.authed || !store.selectedDevice || !store.playback) return;
  const el = document.activeElement as HTMLElement | null;
  if (el && ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName)) return;
  const d = store.selectedDevice;
  if (e.key === " ") {
    e.preventDefault();
    const playing = store.playback.state === "playing";
    const type = playing ? "pause" : "resume";
    const sent = sendWsCommand({ type, deviceId: d });
    if (!sent) void (playing ? api.pause(d) : api.resume(d));
  } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
    e.preventDefault();
    const pos = Math.max(0, (store.playback.position ?? 0) + (e.key === "ArrowRight" ? 5 : -5));
    const sent = sendWsCommand({ type: "seek", deviceId: d, position: pos });
    if (!sent) void api.seek(d, pos);
  } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
    e.preventDefault();
    const vol = Math.min(100, Math.max(0, (store.playback.volume ?? 70) + (e.key === "ArrowUp" ? 5 : -5)));
    sendWsCommand({ type: "setVolume", deviceId: d, volume: vol });
  }
}

const tabs: Array<{ id: Tab; label: string; icon: typeof SearchIcon }> = [
  { id: "search", label: t("tab.search"), icon: SearchIcon },
  { id: "playlists", label: t("tab.playlists"), icon: FolderOpen },
  { id: "favorites", label: t("tab.favorites"), icon: Heart },
  { id: "history", label: t("tab.history"), icon: HistoryIcon },
];
</script>

<template>
  <Login v-if="!store.authed" />

  <div v-else class="mx-auto min-h-screen max-w-md px-4 pb-36 pt-6">
    <header class="mb-5 flex items-center justify-between">
      <div class="flex items-center gap-2.5">
        <div class="flex h-9 w-9 items-center justify-center rounded-xl bg-green-500 text-black shadow-lg shadow-green-500/20">
          <Music :size="19" />
        </div>
        <h1 class="text-lg font-bold tracking-tight">Music Connect</h1>
      </div>
      <!-- user menu -->
      <div class="relative">
        <button
          class="rounded-lg p-2 text-neutral-400 transition hover:bg-white/5 hover:text-white"
          title="Menu"
          @click.stop="menuOpen = !menuOpen"
        >
          <CircleUser :size="18" />
        </button>
        <div
          v-if="menuOpen"
          class="absolute right-0 top-full z-50 mt-1 w-44 overflow-hidden rounded-xl border border-white/10 bg-[#1c1c26] py-1 shadow-2xl shadow-black/60"
        >
          <button
            type="button"
            class="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-sm text-neutral-200 transition hover:bg-white/5"
            @click="openSettings"
          >
            <SettingsIcon :size="14" class="text-neutral-500" />
            {{ t("settings") }}
          </button>
          <button
            type="button"
            class="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-sm text-red-400 transition hover:bg-white/5"
            @click="logout"
          >
            <LogOut :size="14" />
            {{ t("logout") }}
          </button>
        </div>
      </div>
    </header>

    <nav v-if="store.selectedDevice" class="mb-4 flex gap-1 rounded-xl bg-[#14141c] p-1">
      <button
        v-for="t in tabs"
        :key="t.id"
        class="flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-2 transition"
        :class="tab === t.id ? 'bg-white/10 font-semibold text-white' : 'text-neutral-400 hover:text-white'"
        @click="tab = t.id"
      >
        <component :is="t.icon" :size="15" />
        <span class="hidden sm:inline">{{ t.label }}</span>
      </button>
    </nav>

    <div v-if="store.selectedDevice">
      <Search v-if="tab === 'search'" />
      <Playlists v-if="tab === 'playlists'" />
      <Favorites v-if="tab === 'favorites'" />
      <History v-if="tab === 'history'" />
      <Queue v-if="tab !== 'history'" />
    </div>
    <p v-else class="mt-24 text-center text-sm text-neutral-500">
      {{ t("selectDeviceHint") }}
    </p>
  </div>

  <!-- player bar: flat, stuck to the bottom (Spotify style) -->
  <Player />

  <!-- settings page -->
  <Settings v-if="showSettings" @close="showSettings = false" />

  <!-- toast notifications -->
  <Toast />
</template>
