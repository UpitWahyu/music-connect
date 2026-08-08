<script setup lang="ts">
import { ref } from "vue";
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
      class="w-full max-w-xs rounded-2xl border border-gray-700 bg-gray-800 p-6"
      @submit.prevent="submit"
    >
      <h1 class="mb-4 text-center text-xl font-bold">🎵 Music Connect</h1>
      <input
        v-model="username"
        placeholder="Username"
        autocomplete="username"
        class="mb-2 w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm outline-none focus:border-green-500"
      />
      <input
        v-model="password"
        type="password"
        placeholder="Password"
        autocomplete="current-password"
        class="mb-4 w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm outline-none focus:border-green-500"
      />
      <p v-if="error" class="mb-2 text-xs text-red-400">{{ error }}</p>
      <button
        type="submit"
        :disabled="busy"
        class="w-full rounded-lg bg-green-500 py-2 text-sm font-semibold text-black hover:bg-green-400 disabled:opacity-50"
      >
        {{ busy ? "Masuk..." : "Login" }}
      </button>
    </form>
  </div>
</template>
