/**
 * PM2 ecosystem — Music Connect production deploy.
 * Secrets are read from the root .env (gitignored) and passed as env vars;
 * nothing secret is hardcoded here.
 */
const fs = require("node:fs");
const path = require("node:path");

const env = {};
const envFile = path.join(__dirname, ".env");
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2];
  }
}

module.exports = {
  apps: [
    {
      name: "music-server",
      cwd: path.join(__dirname, "apps/server"),
      script: "dist/index.js",
      env: { ...env, PORT: "41019", HOST: "0.0.0.0", NODE_ENV: "production", PREFETCH_ENABLED: "false" },
      max_memory_restart: "512M", // youtubei.js sessions are memory-hungry
      time: true,
    },
    {
      name: "music-web",
      cwd: path.join(__dirname, "apps/web"),
      script: "node_modules/vite/bin/vite.js",
      args: "preview --host 0.0.0.0 --port 41018",
      env: { ...env, PREVIEW_TARGET: "http://localhost:41019" },
      max_memory_restart: "200M",
      time: true,
    },
  ],
};
