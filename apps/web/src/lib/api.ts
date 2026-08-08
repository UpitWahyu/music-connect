/** REST API client for the Music Connect web controller. */

const API_BASE = "/api";

let token: string | null = localStorage.getItem("mc_token");

export function setToken(t: string | null): void {
  token = t;
  if (t) localStorage.setItem("mc_token", t);
  else localStorage.removeItem("mc_token");
}

export function getToken(): string | null {
  return token;
}

export interface TrackDTO {
  id: string;
  provider: string;
  title: string;
  artist: string;
  album?: string;
  duration: number;
  thumbnail?: string;
}

export interface QueueItemDTO {
  id: string;
  track: TrackDTO;
  addedBy: string;
}

export interface PlaybackStateDTO {
  deviceId: string;
  state: string;
  track: TrackDTO | null;
  position: number;
  volume: number;
  queueIndex: number;
  updatedAt: number;
}

export interface DeviceDTO {
  id: string;
  name: string;
  online: boolean;
  type: string;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (init.body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(API_BASE + path, { ...init, headers });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  login: (username: string, password: string) =>
    request<{ token: string }>("/auth/login", { method: "POST", body: JSON.stringify({ username, password }) }),

  devices: () => request<DeviceDTO[]>("/devices"),

  search: (q: string) => request<{ tracks: TrackDTO[] }>("/music/search?q=" + encodeURIComponent(q)),

  playlistMeta: (id: string) =>
    request<{ playlist: { title: string; tracks: TrackDTO[] } | null }>("/music/playlists/" + encodeURIComponent(id)),

  queue: (deviceId: string) => request<{ queue: QueueItemDTO[] }>(`/devices/${deviceId}/queue`),
  addToQueue: (deviceId: string, track: TrackDTO, playNext?: boolean) =>
    request<{ queue: QueueItemDTO[] }>(`/devices/${deviceId}/queue`, {
      method: "POST",
      body: JSON.stringify({ track, playNext }),
    }),

  state: (deviceId: string) => request<{ state: PlaybackStateDTO | null }>(`/devices/${deviceId}/state`),

  play: (deviceId: string, trackId?: string) =>
    request<{ ok: boolean }>(`/devices/${deviceId}/play`, { method: "POST", body: JSON.stringify(trackId ? { trackId } : {}) }),
  pause: (deviceId: string) => request(`/devices/${deviceId}/pause`, { method: "POST", body: "{}" }),
  resume: (deviceId: string) => request(`/devices/${deviceId}/resume`, { method: "POST", body: "{}" }),
  next: (deviceId: string) => request(`/devices/${deviceId}/next`, { method: "POST", body: "{}" }),
  previous: (deviceId: string) => request(`/devices/${deviceId}/previous`, { method: "POST", body: "{}" }),
  volume: (deviceId: string, volume: number) =>
    request(`/devices/${deviceId}/volume`, { method: "POST", body: JSON.stringify({ volume }) }),

  playPlaylist: (deviceId: string, playlistId: string) =>
    request<{ queued: number; first: TrackDTO | null }>(`/devices/${deviceId}/playlist`, {
      method: "POST",
      body: JSON.stringify({ playlistId }),
    }),
};
