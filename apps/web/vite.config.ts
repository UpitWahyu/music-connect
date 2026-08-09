import { defineConfig, loadEnv } from "vite";
import vue from "@vitejs/plugin-vue";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const target = env.PROXY_TARGET ?? "http://localhost:3000";
  return {
    plugins: [vue(), tailwindcss()],
    server: {
      port: 5173,
      // dev proxy → music server (override with PROXY_TARGET, e.g. :3100)
      proxy: {
        "/api": target,
        "/ws": { target: target.replace(/^http/, "ws"), ws: true },
      },
    },
    preview: {
      port: 3018,
      // production preview proxy → music server (PM2 sets PREVIEW_TARGET)
      proxy: {
        "/api": process.env.PREVIEW_TARGET ?? "http://localhost:3019",
        "/ws": { target: (process.env.PREVIEW_TARGET ?? "http://localhost:3019").replace(/^http/, "ws"), ws: true },
      },
    },
  };
});
