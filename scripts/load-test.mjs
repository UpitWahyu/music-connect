#!/usr/bin/env node
/**
 * Minimal load test (P2 §28): N concurrent playback commands against a
 * running server. Validates the p95 target (< 200ms per playback command)
 * under local conditions — run from a machine with server access.
 *
 * Usage:
 *   MUSIC_USERNAME=wahyu MUSIC_PASSWORD=xxx \
 *   MUSIC_SERVER_URL=http://localhost:3019 DEVICE_ID="Redmi Note 7" \
 *   node scripts/load-test.mjs
 *
 * Exit code 0 when p95 ≤ LOAD_P95_TARGET_MS (default 200ms), 1 otherwise.
 */
const base = process.env.MUSIC_SERVER_URL ?? "http://localhost:3019";
const username = process.env.MUSIC_USERNAME;
const password = process.env.MUSIC_PASSWORD;
const deviceId = process.env.DEVICE_ID ?? "desktop";
const p95Target = Number(process.env.LOAD_P95_TARGET_MS ?? 200);

if (!username || !password) {
  console.error("[load-test] MUSIC_USERNAME / MUSIC_PASSWORD required");
  process.exit(2);
}

const login = await fetch(`${base}/api/auth/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ username, password }),
});
const token = (await login.json()).token;
const auth = { authorization: `Bearer ${token}`, "content-type": "application/json" };

/** Latency percentiles helper. */
function pct(sorted, p) {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

const results = {};
async function bench(name, n, fn) {
  const started = Date.now();
  const latencies = [];
  await Promise.all(
    Array.from({ length: n }, async () => {
      const t0 = performance.now();
      await fn();
      latencies.push(performance.now() - t0);
    }),
  );
  latencies.sort((a, b) => a - b);
  results[name] = {
    totalMs: Date.now() - started,
    p50: Math.round(pct(latencies, 50)),
    p95: Math.round(pct(latencies, 95)),
    p99: Math.round(pct(latencies, 99)),
  };
}

const stateUrl = `${base}/api/devices/${encodeURIComponent(deviceId)}/state`;
const playUrl = `${base}/api/devices/${encodeURIComponent(deviceId)}/play`;

await bench("state reads", 100, () => fetch(stateUrl, { headers: auth }));
await bench("queue clear+add (mutations)", 50, async () => {
  await fetch(`${base}/api/devices/${encodeURIComponent(deviceId)}/queue`, {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      track: { id: `loadtest-${Math.random()}`, provider: "youtube-music", title: "Load Test", artist: "QA", duration: 60 },
    }),
  });
});
await bench("playback commands", 100, () =>
  fetch(playUrl, {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      trackId: "dQw4w9WgXcQ",
      track: { id: "dQw4w9WgXcQ", provider: "youtube-music", title: "Load Test", artist: "QA", duration: 60 },
    }),
  }).catch(() => null), // player may be offline — measure latency, not success
);

for (const [name, r] of Object.entries(results)) {
  console.log(`${name.padEnd(28)} p50=${r.p50}ms p95=${r.p95}ms p99=${r.p99}ms total=${r.totalMs}ms`);
}

const worst = Math.max(...Object.values(results).map((r) => r.p95));
console.log(`\np95 target: ${p95Target}ms → ${worst <= p95Target ? "PASS" : "FAIL"} (worst p95=${worst}ms)`);
process.exit(worst <= p95Target ? 0 : 1);
