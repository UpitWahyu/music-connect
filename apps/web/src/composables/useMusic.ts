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
}

export async function refreshPlaylists(): Promise<void> {
  store.playlists = (await api.playlists()).playlists;
}

export async function selectDevice(id: string): Promise<void> {
  store.selectedDevice = id;
  await refreshAll();
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
