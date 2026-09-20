import { createApp } from "vue";
import App from "./App.vue";
import "./style.css";
import { initAuth } from "./lib/api";
import { store } from "./composables/useMusic";

// SEC-06: restore the session from the HttpOnly refresh cookie before the app
// renders — the access token is no longer persisted in localStorage.
async function bootstrap(): Promise<void> {
  try {
    store.authed = await initAuth();
  } catch {
    store.authed = false;
  }
  createApp(App).mount("#app");
}

void bootstrap();
