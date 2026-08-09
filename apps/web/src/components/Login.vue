<script setup lang="ts">
import { ref } from "vue";
import { Music, LogIn } from "lucide-vue-next";
import { login } from "../composables/useMusic";

const username = ref("admin");
const password = ref("");
const error = ref("");
const busy = ref(false);

async function submit(): Promise<void> {
  busy.value = true;
  error.value = "";
  try {
    await login(username.value, password.value);
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="flex min-h-screen items-center justify-center p-4">
    <form
      class="w-full max-w-xs rounded-2xl border border-white/5 bg-[#14141c] p-6 shadow-2xl shadow-black/40"
      @submit.prevent="submit"
    >
      <div class="mb-4 flex flex-col items-center gap-3">
        <div class="flex h-12 w-12 items-center justify-center rounded-2xl bg-green-500 text-black">
          <Music :size="24" />
        </div>
        <h1 class="text-xl font-bold tracking-tight">Music Connect</h1>
        <p class="text-xs text-neutral-500">Kontrol musik dari mana saja</p>
      </div>
      <input
        v-model="username"
        placeholder="Username"
        autocomplete="username"
        class="mb-2 w-full rounded-lg border border-white/5 bg-black/30 px-3 py-2.5 text-sm outline-none placeholder:text-neutral-600 focus:border-green-500/50"
      />
      <input
        v-model="password"
        type="password"
        placeholder="Password"
        autocomplete="current-password"
        class="mb-4 w-full rounded-lg border border-white/5 bg-black/30 px-3 py-2.5 text-sm outline-none placeholder:text-neutral-600 focus:border-green-500/50"
      />
      <p v-if="error" class="mb-2 text-xs text-red-400">{{ error }}</p>
      <button
        type="submit"
        :disabled="busy"
        class="flex w-full items-center justify-center gap-2 rounded-lg bg-green-500 py-2.5 text-sm font-semibold text-black transition hover:bg-green-400 disabled:opacity-50"
      >
        <LogIn :size="16" />
        {{ busy ? "Masuk..." : "Login" }}
      </button>
    </form>
  </div>
</template>
