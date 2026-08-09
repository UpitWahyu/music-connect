import { reactive } from "vue";
import { api, getToken, setToken, type DeviceDTO, type FavoriteDTO, type PlaybackStateDTO, type PlaylistDTO, type QueueItemDTO } from "../lib/api";
import { connectControllerWs } from "../lib/ws";

export const store = reactive({
  authed: getToken() !== null,
  devices: [] as DeviceDTO[],
  selectedDevice: null as string | null,
  queue: [] as QueueItemDTO[],
  queueIndex: 0, // GLOBAL queue cursor — independent of the selected device
  playback: null as PlaybackStateDTO | null,
  playlists: [] as PlaylistDTO[],
  favorites: [] as FavoriteDTO[],
});

export async function login(username: string, password: string): Promise<void> {
  const { token } = await api.login(username, password);
  setToken(token);
  store.authed = true;
  await refreshDevices();
  // restore the account-wide selected device (cross-browser sync)
  const sel = await api.getSelectedDevice().catch(() => null);
  if (sel?.deviceId && store.devices.some((d) => d.id === sel.deviceId)) {
    store.selectedDevice = sel.deviceId;
    await refreshAll();
  }
  await refreshPlaylists();
  await refreshFavorites();
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
  store.favorites = [];
}

export async function refreshDevices(): Promise<void> {
  store.devices = await api.devices();
  // Auto-select: when nothing is selected (or the selection vanished),
  // pick the first online device (Spotify-like "play here" behaviour).
  const cur = store.devices.find((d) => d.id === store.selectedDevice);
  if ((!store.selectedDevice || !cur) && store.devices.length) {
    const online = store.devices.find((d) => d.online);
    if (online) {
      store.selectedDevice = online.id;
      await Promise.all([refreshQueue(), refreshState()]);
    }
  }
}

export async function refreshPlaylists(): Promise<void> {
  store.playlists = (await api.playlists()).playlists;
}

export async function refreshFavorites(): Promise<void> {
  store.favorites = (await api.favorites()).favorites;
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
  // only auto-transfer when the source device is actually playing something
  if (from && from !== id && target?.online && store.playback?.track) {
    try {
      await api.transfer(from, id); // stop old, load + seek on new (D-10)
    } catch {
      // old device offline or transfer failed — plain switch instead
    }
  }
  await selectDevice(id);
  // sync the choice to the account so every browser follows (cross-device)
  void api.setSelectedDevice(id).catch(() => null);
}

export async function refreshQueue(): Promise<void> {
  if (!store.selectedDevice) return;
  const r = await api.queue(store.selectedDevice);
  store.queue = r.queue;
  store.queueIndex = r.index ?? 0;
}

export async function refreshState(): Promise<void> {
  if (!store.selectedDevice) return;
  store.playback = (await api.state(store.selectedDevice)).state;
}

export async function refreshAll(): Promise<void> {
  await Promise.all([refreshQueue(), refreshState()]);
}

// --- polling fallback (WS events make this unnecessary later) ---
let pollTimer: ReturnType<typeof setInterval> | null = null;

/** Cross-browser fallback: follow the account-wide selected device. */
async function syncSelectedDevice(): Promise<void> {
  const sel = await api.getSelectedDevice().catch(() => null);
  if (
    sel?.deviceId &&
    sel.deviceId !== store.selectedDevice &&
    store.devices.some((d) => d.id === sel.deviceId)
  ) {
    store.selectedDevice = sel.deviceId;
    void refreshAll();
  }
}

export function startPolling(): void {
  if (pollTimer) return;
  pollTimer = setInterval(() => {
    void refreshAll();
    void refreshDevices(); // keep device list fresh (auto-select when online appears)
    void syncSelectedDevice(); // device selection sync even if WS events drop
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
    } else if (event.type === "device.selected") {
      // another browser/tab changed the device — follow it
      const id = event.deviceId;
      if (id && id !== store.selectedDevice && store.devices.some((d) => d.id === id)) {
        store.selectedDevice = id;
        void refreshAll();
      }
    }
  });
}

export function stopRealtime(): void {
  disconnectWs?.();
  disconnectWs = null;
}
