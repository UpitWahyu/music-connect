<script setup lang="ts">
import { CheckCircle2, AlertCircle, Info } from "lucide-vue-next";
import { toasts } from "../composables/useToast";
</script>

<template>
  <div class="pointer-events-none fixed inset-x-0 bottom-20 z-[80] flex flex-col items-center gap-2 px-4">
    <transition-group name="toast">
      <div
        v-for="t in toasts"
        :key="t.id"
        class="pointer-events-auto flex max-w-sm items-center gap-2 rounded-xl border px-3.5 py-2.5 text-sm shadow-2xl shadow-black/60 backdrop-blur"
        :class="
          t.type === 'success'
            ? 'border-green-500/30 bg-[#101a13]/95 text-green-200'
            : t.type === 'error'
              ? 'border-red-500/30 bg-[#1a1010]/95 text-red-200'
              : 'border-white/10 bg-[#16161f]/95 text-neutral-200'
        "
      >
        <CheckCircle2 v-if="t.type === 'success'" :size="15" class="shrink-0 text-green-400" />
        <AlertCircle v-else-if="t.type === 'error'" :size="15" class="shrink-0 text-red-400" />
        <Info v-else :size="15" class="shrink-0 text-neutral-400" />
        <span class="min-w-0 truncate">{{ t.message }}</span>
      </div>
    </transition-group>
  </div>
</template>

<style scoped>
.toast-enter-active,
.toast-leave-active {
  transition: all 0.25s ease;
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(8px);
}
</style>
