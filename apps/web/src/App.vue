<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import { Music, Search as SearchIcon, FolderOpen, Heart, History as HistoryIcon, LogOut, KeyRound, X } from "lucide-vue-next";
import { api } from "./lib/api";
import { store, refreshDevices, startPolling, stopPolling, logout } from "./composables/useMusic";
import { showToast } from "./composables/useToast";
import Login from "./components/Login.vue";
import Search from "./components/Search.vue";
import Player from "./components/Player.vue";
import Queue from "./components/Queue.vue";
import Playlists from "./components/Playlists.vue";
import Favorites from "./components/Favorites.vue";
import History from "./components/History.vue";
import Toast from "./components/Toast.vue";

type Tab = "search" | "playlists" | "favorites" | "history";
const tab = ref<Tab>("search");

// --- change password (DB-backed credentials) ---
const showPw = ref(false);
const oldPw = ref("");
const newPw = ref("");
const confirmPw = ref("");
const pwMsg = ref("");
const pwBusy = ref(false);

async function changePassword(): Promise<void> {
  pwMsg.value = "";
  if (newPw.value.length < 6) {
    pwMsg.value = "Password baru minimal 6 karakter";
    return;
  }
  if (newPw.value !== confirmPw.value) {
    pwMsg.value = "Konfirmasi password tidak sama";
    return;
  }
  pwBusy.value = true;
  try {
    await api.changePassword(oldPw.value, newPw.value);
    showPw.value = false;
    oldPw.value = newPw.value = confirmPw.value = "";
    showToast("Password berhasil diganti");
  } catch (e) {
    pwMsg.value = (e as Error).message || "Gagal mengganti password";
  } finally {
    pwBusy.value = false;
  }
}

const tabs: Array<{ id: Tab; label: string; icon: typeof SearchIcon }> = [
  { id: "search", label: "Cari", icon: SearchIcon },
  { id: "playlists", label: "Playlist", icon: FolderOpen },
  { id: "favorites", label: "Favorit", icon: Heart },
  { id: "history", label: "Riwayat", icon: HistoryIcon },
];

onMounted(() => {
  if (store.authed) {
    void refreshDevices();
    startPolling();
  }
});
onUnmounted(stopPolling);
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
      <div class="flex items-center gap-1">
        <button
          class="rounded-lg p-2 text-neutral-400 transition hover:bg-white/5 hover:text-white"
          title="Ganti password"
          @click="showPw = true"
        >
          <KeyRound :size="16" />
        </button>
        <button
          class="rounded-lg p-2 text-neutral-400 transition hover:bg-white/5 hover:text-white"
          title="Logout"
          @click="logout"
        >
          <LogOut :size="16" />
        </button>
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
      <Queue v-if="tab !== 'history'" class="mt-6" />
    </div>
    <p v-else class="mt-24 text-center text-sm text-neutral-500">
      Pilih device untuk mulai mendengarkan
    </p>
  </div>

  <!-- player bar: flat, stuck to the bottom (Spotify style) -->
  <Player />

  <!-- change password modal -->
  <div
    v-if="showPw"
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
    @click.self="showPw = false"
  >
    <div class="w-full max-w-md rounded-2xl border border-white/10 bg-[#16161f] p-5 shadow-2xl shadow-black/60">
      <div class="mb-3 flex items-center justify-between">
        <h3 class="flex items-center gap-2 text-sm font-semibold">
          <KeyRound :size="15" class="text-green-400" />
          Ganti Password
        </h3>
        <button type="button" class="rounded-lg p-1.5 text-neutral-400 transition hover:bg-white/10 hover:text-white" @click="showPw = false">
          <X :size="15" />
        </button>
      </div>
      <div class="space-y-2.5">
        <input v-model="oldPw" type="password" placeholder="Password lama" class="w-full rounded-xl border border-white/5 bg-[#14141c] px-3 py-2.5 text-sm outline-none placeholder:text-neutral-600 focus:border-green-500/40" />
        <input v-model="newPw" type="password" placeholder="Password baru (min. 6 karakter)" class="w-full rounded-xl border border-white/5 bg-[#14141c] px-3 py-2.5 text-sm outline-none placeholder:text-neutral-600 focus:border-green-500/40" />
        <input v-model="confirmPw" type="password" placeholder="Ulangi password baru" class="w-full rounded-xl border border-white/5 bg-[#14141c] px-3 py-2.5 text-sm outline-none placeholder:text-neutral-600 focus:border-green-500/40" @keyup.enter="changePassword" />
      </div>
      <p v-if="pwMsg" class="mt-2 text-xs text-red-400">{{ pwMsg }}</p>
      <div class="mt-4 flex gap-2">
        <button
          class="flex-1 rounded-xl bg-green-500 py-2.5 text-sm font-semibold text-black transition hover:bg-green-400 disabled:opacity-50"
          :disabled="pwBusy || !oldPw || !newPw || !confirmPw"
          @click="changePassword"
        >
          {{ pwBusy ? "Menyimpan…" : "Simpan" }}
        </button>
        <button type="button" class="rounded-xl bg-white/10 px-4 text-sm transition hover:bg-white/15" @click="showPw = false">
          Batal
        </button>
      </div>
    </div>
  </div>

  <!-- toast notifications -->
  <Toast />
</template>
