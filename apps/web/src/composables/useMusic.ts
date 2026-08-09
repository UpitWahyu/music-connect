import { reactive } from "vue";
import { api, getToken, setToken, type DeviceDTO, type PlaybackStateDTO, type PlaylistDTO, type QueueItemDTO } from "../lib/api";
import { connectControllerWs } from "../lib/ws";

export const store = reactive({
  authed: getToken() !== null,
  devices: [] as DeviceDTO[],
  selectedDevice: null as string | null,
  queue: [] as QueueItemDTO[],
  playback: null as PlaybackStateDTO | null,
  playlists: [] as PlaylistDTO[],
});

export async function login(username: string, password: string): Promise<void> {
  const { token } = await api.login(username, password);
  setToken(token);
  store.authed = true;
  await refreshDevices();
  await refreshPlaylists();
  startRealtime();
  startPolling();
}

export function logout(): void {
  stopRealtime();
  stopPolling();
  setToken(null);
  store.authed = false;
  store.selectedDevice = null;
  store.devices = [];
  store.queue = [];
  store.playback = null;
  store.playlists = [];
}

export async function refreshDevices(): Promise<void> {
  store.devices = await api.devices();
  // Auto-select: when nothing is selected (or the selection vanished),
  // pick the first online device (Spotify-like "play here" behaviour).
  const cur = store.devices.find((d) => d.id === store.selectedDevice);
  if ((!store.selectedDevice || !cur) && store.devices.length) {
    const online = store.devices.find((d) => d.online) ?? store.devices[0];
    store.selectedDevice = online.id;
    await Promise.all([refreshQueue(), refreshState()]);
  }
}

export async function refreshPlaylists(): Promise<void> {
  store.playlists = (await api.playlists()).playlists;
}

export async function selectDevice(id: string): Promise<void> {
  store.selectedDevice = id;
  await refreshAll();
}

/**
 * Select a device. When switching to a different *online* device, playback is
 * auto-transferred there (old device stops, track + position move with it).
 */
export async function selectDeviceAuto(id: string): Promise<void> {
  const from = store.selectedDevice;
  const target = store.devices.find((d) => d.id === id);
  if (from && from !== id && target?.online) {
    try {
      await api.transfer(from, id); // stop old, load + seek on new (D-10)
    } catch {
      // old device offline or transfer failed — plain switch instead
    }
  }
  await selectDevice(id);
}

export async function refreshQueue(): Promise<void> {
  if (!store.selectedDevice) return;
  store.queue = (await api.queue(store.selectedDevice)).queue;
}

export async function refreshState(): Promise<void> {
  if (!store.selectedDevice) return;
  store.playback = (await api.state(store.selectedDevice)).state;
}

export async function refreshAll(): Promise<void> {
  await Promise.all([refreshQueue(), refreshState()]);
}

// --- polling fallback (WS events will make this unnecessary later) ---
let pollTimer: ReturnType<typeof setInterval> | null = null;

export function startPolling(): void {
  if (pollTimer) return;
  pollTimer = setInterval(() => {
    void refreshAll();
    void refreshDevices(); // keep device list fresh (auto-select when online appears)
  }, 3000);
}

export function stopPolling(): void {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}

// --- realtime (WS) ---
let disconnectWs: (() => void) | null = null;

export function startRealtime(): void {
  stopRealtime();
  disconnectWs = connectControllerWs((event) => {
    if (event.type === "queue.updated" && event.deviceId === store.selectedDevice) {
      void refreshQueue();
    } else if (event.type === "player.state" && event.deviceId === store.selectedDevice) {
      void refreshState();
    }
  });
}

export function stopRealtime(): void {
  disconnectWs?.();
  disconnectWs = null;
}
