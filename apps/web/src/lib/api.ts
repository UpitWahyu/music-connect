/** REST API client for the Music Connect web controller. */

const API_BASE = "/api";

const TOKEN_KEY = "mc_token";
const REFRESH_KEY = "mc_refresh_token";

let token: string | null = localStorage.getItem(TOKEN_KEY);
let refreshToken: string | null = localStorage.getItem(REFRESH_KEY);

export function setToken(t: string | null): void {
  token = t;
  if (t) localStorage.setItem(TOKEN_KEY, t);
  else localStorage.removeItem(TOKEN_KEY);
}

export function getToken(): string | null {
  return token;
}

export function setRefreshToken(t: string | null): void {
  refreshToken = t;
  if (t) localStorage.setItem(REFRESH_KEY, t);
  else localStorage.removeItem(REFRESH_KEY);
}

export function getRefreshToken(): string | null {
  return refreshToken;
}

/** Wipe all auth state (call on logout / auth failure). */
export function clearTokens(): void {
  setToken(null);
  setRefreshToken(null);
}

/**
 * Decode the `exp` claim of a JWT WITHOUT verifying the signature
 * (we just need the expiry to decide whether to refresh). Returns null
 * if the token is malformed.
 */
function decodeJwtExp(t: string): number | null {
  try {
    const parts = t.split(".");
    if (parts.length !== 3) return null;
    const payload = JSON.parse(atob(parts[1]!.replace(/-/g, "+").replace(/_/g, "/")));
    return typeof payload.exp === "number" ? payload.exp : null;
  } catch {
    return null;
  }
}

let refreshing: Promise<{ ok: boolean; fatal: boolean }> | null = null;

/**
 * Refresh the access token using the stored refresh token. Returns:
 *   { ok: true }                         — token refreshed, session continues
 *   { ok: false, fatal: true }           — definite auth failure (401/403): logout
 *   { ok: false, fatal: false }          — transient (network/429/5xx): do NOT logout,
 *                                           let the caller retry without nuking the session
 * Concurrent callers share one in-flight refresh so we don't fire a storm of
 * /refresh requests.
 */
async function tryRefresh(): Promise<{ ok: boolean; fatal: boolean }> {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    const rt = refreshToken;
    if (!rt) return { ok: false, fatal: true };
    try {
      const res = await fetch(API_BASE + "/auth/refresh", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refreshToken: rt }),
      });
      if (res.ok) {
        const data = (await res.json()) as { token: string; refreshToken?: string };
        setToken(data.token);
        if (data.refreshToken) setRefreshToken(data.refreshToken);
        return { ok: true, fatal: false };
      }
      // Only a definitive auth rejection is fatal; rate-limit/network blips are not.
      return { ok: false, fatal: res.status === 401 || res.status === 403 };
    } catch {
      // network error — transient; don't logout
      return { ok: false, fatal: false };
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

function redirectToLogin(): void {
  clearTokens();
  // SPA: drop to the login view. store.authed is derived from getToken() lazily
  // by the app shell; a full reload guarantees a clean state.
  if (typeof location !== "undefined") location.href = "/";
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
  shuffle?: boolean;
  repeat?: "off" | "all" | "one";
  updatedAt: number;
}

export interface DeviceDTO {
  id: string;
  name: string;
  online: boolean;
  type: string;
}

export interface PlaylistDTO {
  id: string;
  name: string;
  _count: { tracks: number };
  createdAt: string;
}

export interface PlaylistTrackDTO {
  trackId: string;
  provider: string;
  title: string;
  artist: string;
  album?: string | null;
  duration: number;
  thumbnail?: string | null;
}

export interface FavoriteDTO {
  trackId: string;
  title: string;
  artist: string;
}

export interface HistoryDTO {
  id: string;
  trackId: string;
  title: string;
  artist: string;
  deviceId?: string | null;
  playedAt: string;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  // Login and refresh are the only unauthenticated/auth-establishing calls —
  // never try to refresh before them (no token yet, or we'd loop).
  const isAuthBootstrap = path === "/auth/login" || path === "/auth/refresh";

  if (!isAuthBootstrap && token) {
    const exp = decodeJwtExp(token);
    const now = Math.floor(Date.now() / 1000);
    // Refresh if expired or expiring within 60s.
    if (exp !== null && exp - now <= 60) {
      const ok = await tryRefresh();
      if (!ok) {
        redirectToLogin();
        throw new Error("SESSION_EXPIRED");
      }
    }
  }

  const headers: Record<string, string> = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (init.body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(API_BASE + path, { ...init, headers });
  if (res.status === 401 && !isAuthBootstrap) {
    // Access token rejected despite not being "expired" per local clock —
    // attempt one refresh, then retry once. Only a *definitive* auth failure
    // (401/403 from /refresh) logs the user out; transient issues (network blip,
    // 429 rate-limit, 5xx) must NOT nuke the session — throw RETRY_LATER instead.
    const refresh = await tryRefresh();
    if (refresh.ok) {
      const retryHeaders: Record<string, string> = {};
      if (token) retryHeaders.authorization = `Bearer ${token}`;
      if (init.body !== undefined) retryHeaders["content-type"] = "application/json";
      const retry = await fetch(API_BASE + path, { ...init, headers: retryHeaders });
      if (!retry.ok) {
        const body = (await retry.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${retry.status}`);
      }
      return retry.json() as Promise<T>;
    }
    if (refresh.fatal) {
      redirectToLogin();
      throw new Error("SESSION_EXPIRED");
    }
    // transient refresh failure — keep tokens, let the UI retry
    throw new Error("RETRY_LATER");
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  login: async (username: string, password: string) => {
    const data = await request<{ token: string; refreshToken: string }>(
      "/auth/login",
      { method: "POST", body: JSON.stringify({ username, password }) },
    );
    setToken(data.token);
    setRefreshToken(data.refreshToken);
    return data;
  },

  devices: () => request<DeviceDTO[]>("/devices"),

  search: (q: string) => request<{ tracks: TrackDTO[] }>("/music/search?q=" + encodeURIComponent(q)),

  playlistMeta: (id: string) =>
    request<{ playlist: { title: string; tracks: TrackDTO[] } | null }>("/music/playlists/" + encodeURIComponent(id)),

  queue: (deviceId: string) => request<{ queue: QueueItemDTO[]; index: number }>(`/devices/${deviceId}/queue`),
  clearQueue: (deviceId: string) =>
    request<{ queue: QueueItemDTO[] }>(`/devices/${deviceId}/queue/clear`, { method: "POST", body: "{}" }),
  reorderQueue: (deviceId: string, order: string[]) =>
    request<{ queue: QueueItemDTO[] }>(`/devices/${deviceId}/queue/reorder`, {
      method: "PUT",
      body: JSON.stringify({ order }),
    }),
  playQueueItem: (deviceId: string, itemId: string) =>
    request<{ ok: boolean }>(`/devices/${deviceId}/queue/${itemId}/play`, { method: "POST", body: "{}" }),
  addToQueue: (deviceId: string, track: TrackDTO, playNext?: boolean) =>
    request<{ queue: QueueItemDTO[] }>(`/devices/${deviceId}/queue`, {
      method: "POST",
      body: JSON.stringify({ track, playNext }),
    }),

  state: (deviceId: string) => request<{ state: PlaybackStateDTO | null }>(`/devices/${deviceId}/state`),

  play: (deviceId: string, trackId?: string, track?: TrackDTO) =>
    request<{ ok: boolean }>(`/devices/${deviceId}/play`, {
      method: "POST",
      body: JSON.stringify(trackId ? { trackId, track } : {}),
    }),
  pause: (deviceId: string) => request(`/devices/${deviceId}/pause`, { method: "POST", body: "{}" }),
  resume: (deviceId: string) => request(`/devices/${deviceId}/resume`, { method: "POST", body: "{}" }),
  next: (deviceId: string) => request(`/devices/${deviceId}/next`, { method: "POST", body: "{}" }),
  previous: (deviceId: string) => request(`/devices/${deviceId}/previous`, { method: "POST", body: "{}" }),
  seek: (deviceId: string, position: number) =>
    request(`/devices/${deviceId}/seek`, { method: "POST", body: JSON.stringify({ position }) }),
  shuffle: (deviceId: string, shuffle: boolean) =>
    request(`/devices/${deviceId}/shuffle`, { method: "POST", body: JSON.stringify({ shuffle }) }),
  repeat: (deviceId: string, mode: "off" | "all" | "one") =>
    request(`/devices/${deviceId}/repeat`, { method: "POST", body: JSON.stringify({ mode }) }),
  volume: (deviceId: string, volume: number) =>
    request(`/devices/${deviceId}/volume`, { method: "POST", body: JSON.stringify({ volume }) }),
  transfer: (from: string, to: string) =>
    request(`/devices/${from}/transfer`, { method: "POST", body: JSON.stringify({ to }) }),

  playPlaylist: (deviceId: string, playlistId: string) =>
    request<{ queued: number; first: TrackDTO | null }>(`/devices/${deviceId}/playlist`, {
      method: "POST",
      body: JSON.stringify({ playlistId }),
    }),

  // --- Phase 8: persistent library ---
  createPlaylist: (name: string) => request<{ playlist: { id: string; name: string } }>("/playlists", { method: "POST", body: JSON.stringify({ name }) }),
  playlists: () => request<{ playlists: PlaylistDTO[] }>("/playlists"),
  playlistsWithTrack: (trackId: string) =>
    request<{ playlists: { id: string; name: string; contains: boolean }[] }>(
      "/playlists/contains/" + encodeURIComponent(trackId),
    ),
  playlistDetail: (id: string) => request<{ playlist: { id: string; name: string; tracks: PlaylistTrackDTO[] } | null }>(`/playlists/${id}`),
  deletePlaylist: (id: string) => request(`/playlists/${id}`, { method: "DELETE" }),
  addToPlaylist: (playlistId: string, track: TrackDTO) =>
    request<{ ok: boolean }>(`/playlists/${playlistId}/tracks`, { method: "POST", body: JSON.stringify({ track }) }),
  removeFromPlaylist: (playlistId: string, trackId: string) =>
    request(`/playlists/${playlistId}/tracks/${trackId}`, { method: "DELETE" }),
  playLocalPlaylist: (playlistId: string, deviceId: string) =>
    request<{ queued: number; first: TrackDTO | null }>(`/playlists/${playlistId}/play`, { method: "POST", body: JSON.stringify({ deviceId }) }),

  favorites: () => request<{ favorites: FavoriteDTO[] }>("/favorites"),
  addFavorite: (track: TrackDTO) => request<{ ok: boolean }>("/favorites", { method: "POST", body: JSON.stringify({ track }) }),
  removeFavorite: (trackId: string) => request(`/favorites/${trackId}`, { method: "DELETE" }),

  history: () => request<{ history: HistoryDTO[] }>("/history"),
  clearHistory: () => request<{ ok: boolean }>("/history", { method: "DELETE" }),
  changePassword: (oldPassword: string, newPassword: string) =>
    request<{ ok: boolean }>("/auth/password", {
      method: "PUT",
      body: JSON.stringify({ oldPassword, newPassword }),
    }),
  changeUsername: (password: string, newUsername: string) =>
    request<{ ok: boolean }>("/auth/profile", {
      method: "PUT",
      body: JSON.stringify({ password, newUsername }),
    }),
  pairDevice: (deviceId: string) =>
    request<{ pairingCode: string; expiresIn: number; deviceId: string }>(
      "/devices/" + encodeURIComponent(deviceId) + "/pair",
      { method: "POST", body: "{}" },
    ),
  getSelectedDevice: () => request<{ deviceId: string | null }>("/selected-device"),
  setSelectedDevice: (deviceId: string) =>
    request<{ ok: boolean }>("/selected-device", { method: "PUT", body: JSON.stringify({ deviceId }) }),
};
