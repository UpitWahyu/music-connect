<script setup lang="ts">
import { ref } from "vue";
import { ArrowLeft, User, KeyRound, Link2, Copy, Check, Languages } from "lucide-vue-next";
import { api } from "../lib/api";
import { showToast } from "../composables/useToast";
import { t, i18n, setLang, type Lang } from "../i18n";

const emit = defineEmits<{ close: [] }>();

// --- language ---
const langs: Array<{ id: Lang; label: string }> = [
  { id: "id", label: "Indonesia" },
  { id: "en", label: "English" },
];

// --- username ---
const uname = ref("");
const unamePw = ref("");
const unameBusy = ref(false);
const unameMsg = ref("");

async function saveUsername(): Promise<void> {
  unameMsg.value = "";
  if (uname.value.trim().length < 3) {
    unameMsg.value = i18n.lang === "id" ? "Username minimal 3 karakter" : "Username must be at least 3 characters";
    return;
  }
  unameBusy.value = true;
  try {
    await api.changeUsername(unamePw.value, uname.value.trim());
    uname.value = "";
    unamePw.value = "";
    showToast(i18n.lang === "id" ? "Username diganti" : "Username updated");
  } catch (e) {
    unameMsg.value = (e as Error).message || "Gagal";
  } finally {
    unameBusy.value = false;
  }
}

// --- password ---
const oldPw = ref("");
const newPw = ref("");
const confirmPw = ref("");
const pwMsg = ref("");
const pwBusy = ref(false);

async function savePassword(): Promise<void> {
  pwMsg.value = "";
  if (newPw.value.length < 6) {
    pwMsg.value = i18n.lang === "id" ? "Password baru minimal 6 karakter" : "New password must be at least 6 characters";
    return;
  }
  if (newPw.value !== confirmPw.value) {
    pwMsg.value = i18n.lang === "id" ? "Konfirmasi password tidak sama" : "Passwords do not match";
    return;
  }
  pwBusy.value = true;
  try {
    await api.changePassword(oldPw.value, newPw.value);
    oldPw.value = newPw.value = confirmPw.value = "";
    showToast(i18n.lang === "id" ? "Password diganti" : "Password updated");
  } catch (e) {
    pwMsg.value = (e as Error).message || "Gagal";
  } finally {
    pwBusy.value = false;
  }
}

// --- pairing code ---
const devId = ref("");
const pairBusy = ref(false);
const pairMsg = ref("");
const pairCode = ref("");
const pairExpires = ref(0);
const copied = ref(false);

async function createPairingCode(): Promise<void> {
  pairMsg.value = "";
  if (!devId.value.trim()) {
    pairMsg.value = i18n.lang === "id" ? "Isi device ID dulu (mis. android-tv)" : "Enter a device ID first (e.g. android-tv)";
    return;
  }
  pairBusy.value = true;
  try {
    const r = await api.pairDevice(devId.value.trim());
    pairCode.value = r.pairingCode;
    pairExpires.value = r.expiresIn;
    copied.value = false;
  } catch (e) {
    pairMsg.value = (e as Error).message || "Gagal";
  } finally {
    pairBusy.value = false;
  }
}

async function copyCode(): Promise<void> {
  await navigator.clipboard?.writeText(pairCode.value).catch(() => null);
  copied.value = true;
  setTimeout(() => (copied.value = false), 1500);
}

const inputCls =
  "w-full rounded-xl border border-white/5 bg-[#14141c] px-4 py-2.5 text-sm outline-none placeholder:text-neutral-600 focus:border-green-500/40";
const sectionCls = "mb-8 rounded-2xl border border-white/5 bg-[#14141c] p-4";
const labelCls = "mb-2.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-neutral-400";
const btnCls =
  "mt-5 w-full rounded-xl bg-green-500 px-4 py-2.5 text-sm font-semibold text-black transition hover:bg-green-400 disabled:opacity-50";
</script>

<template>
  <div class="fixed inset-0 z-[60] overflow-y-auto bg-[#0b0b10]">
    <div class="mx-auto min-h-full max-w-md px-4 py-5 pb-24">
      <header class="mb-5 flex items-center gap-3">
        <button
          type="button"
          class="rounded-lg p-2 text-neutral-400 transition hover:bg-white/5 hover:text-white"
          @click="emit('close')"
        >
          <ArrowLeft :size="18" />
        </button>
        <h1 class="text-lg font-bold tracking-tight">{{ t("settingsTitle") }}</h1>
      </header>

      <!-- language -->
      <section :class="sectionCls">
        <h2 :class="labelCls">
          <Languages :size="13" />
          {{ t("settingsLanguage") }}
        </h2>
        <div class="grid grid-cols-2 gap-2">
          <button
            v-for="l in langs"
            :key="l.id"
            type="button"
            class="rounded-xl px-4 py-2.5 text-sm font-medium transition"
            :class="i18n.lang === l.id ? 'bg-green-500 font-semibold text-black' : 'bg-white/10 text-neutral-300 hover:bg-white/15'"
            @click="setLang(l.id)"
          >
            {{ l.label }}
          </button>
        </div>
      </section>

      <!-- account -->
      <section :class="sectionCls">
        <h2 :class="labelCls">
          <User :size="13" />
          {{ t("settingsAccount") }}
        </h2>
        <div class="space-y-3">
          <input v-model="uname" type="text" :placeholder="t('placeholderUsername')" :class="inputCls" />
          <input v-model="unamePw" type="password" :placeholder="t('placeholderVerifyPw')" :class="inputCls" />
        </div>
        <p v-if="unameMsg" class="mt-2 text-xs text-red-400">{{ unameMsg }}</p>
        <button :class="btnCls" :disabled="unameBusy || !uname || !unamePw" @click="saveUsername">
          {{ unameBusy ? t("loading") : t("saveUsername") }}
        </button>
      </section>

      <!-- password -->
      <section :class="sectionCls">
        <h2 :class="labelCls">
          <KeyRound :size="13" />
          {{ t("settingsPassword") }}
        </h2>
        <div class="space-y-3">
          <input v-model="oldPw" type="password" :placeholder="t('placeholderOldPw')" :class="inputCls" />
          <input v-model="newPw" type="password" :placeholder="t('placeholderNewPw')" :class="inputCls" />
          <input v-model="confirmPw" type="password" :placeholder="t('placeholderConfirmPw')" :class="inputCls" @keyup.enter="savePassword" />
        </div>
        <p v-if="pwMsg" class="mt-2 text-xs text-red-400">{{ pwMsg }}</p>
        <button :class="btnCls" :disabled="pwBusy || !oldPw || !newPw || !confirmPw" @click="savePassword">
          {{ pwBusy ? t("loading") : t("savePassword") }}
        </button>
      </section>

      <!-- pairing code -->
      <section :class="sectionCls">
        <h2 :class="labelCls">
          <Link2 :size="13" />
          {{ t("settingsPairing") }}
        </h2>
        <div class="flex gap-2">
          <input v-model="devId" type="text" :placeholder="t('placeholderDeviceId')" :class="inputCls" @keyup.enter="createPairingCode" />
          <button
            type="button"
            class="shrink-0 rounded-xl bg-white/10 px-4 text-sm font-medium transition hover:bg-white/15 disabled:opacity-50"
            :disabled="pairBusy"
            @click="createPairingCode"
          >
            {{ pairBusy ? t("loading") : t("create") }}
          </button>
        </div>
        <p v-if="pairMsg" class="mt-2 text-xs text-red-400">{{ pairMsg }}</p>

        <div v-if="pairCode" class="mt-3 rounded-xl border border-green-500/30 bg-green-500/5 p-3">
          <p class="mb-1 text-xs text-neutral-400">{{ t("pairingCodeValid", { n: pairExpires / 60 }) }}</p>
          <div class="flex items-center justify-between gap-2">
            <code class="text-xl font-bold tracking-widest text-green-400">{{ pairCode }}</code>
            <button type="button" class="rounded-lg p-1.5 text-neutral-400 transition hover:bg-white/10 hover:text-white" @click="copyCode">
              <Check v-if="copied" :size="15" class="text-green-400" />
              <Copy v-else :size="15" />
            </button>
          </div>
          <p class="mt-2 text-xs leading-relaxed text-neutral-500">
            {{ t("pairingInstructions", { code: pairCode }) }}
          </p>
        </div>
      </section>
    </div>
  </div>
</template>
