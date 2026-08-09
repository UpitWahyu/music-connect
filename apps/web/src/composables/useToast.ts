import { reactive } from "vue";

export interface Toast {
  id: number;
  message: string;
  type: "success" | "error" | "info";
}

export const toasts = reactive<Toast[]>([]);

let nextId = 1;

/** Show a small auto-dismissing toast (bottom, above the player bar). */
export function showToast(message: string, type: Toast["type"] = "success", duration = 2500): void {
  const id = nextId++;
  toasts.push({ id, message, type });
  setTimeout(() => {
    const i = toasts.findIndex((t) => t.id === id);
    if (i >= 0) toasts.splice(i, 1);
  }, duration);
}
