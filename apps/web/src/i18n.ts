import { reactive } from "vue";

export type Lang = "id" | "en";

type Dict = Record<string, string>;

const dict: Record<Lang, Dict> = {
  id: {
    // tabs & header
    "tab.search": "Cari",
    "tab.playlists": "Playlist",
    "tab.favorites": "Favorit",
    "tab.history": "Riwayat",
    menu: "Menu",
    settings: "Pengaturan",
    logout: "Logout",
    selectDeviceHint: "Pilih device untuk mulai mendengarkan",
    // settings
    settingsTitle: "Pengaturan",
    settingsLanguage: "Bahasa",
    settingsAccount: "Username",
    settingsPassword: "Password",
    settingsPairing: "Pairing Code (device player baru)",
    saveUsername: "Simpan Username",
    savePassword: "Simpan Password",
    placeholderUsername: "Username baru (min. 3 karakter)",
    placeholderVerifyPw: "Password saat ini (verifikasi)",
    placeholderOldPw: "Password lama",
    placeholderNewPw: "Password baru (min. 6 karakter)",
    placeholderConfirmPw: "Ulangi password baru",
    placeholderDeviceId: "Device ID (mis. android-tv)",
    create: "Buat",
    cancel: "Batal",
    save: "Simpan",
    // settings pairing
    pairingCodeValid: "Kode (berlaku {n} menit, sekali pakai):",
    pairingInstructions: "Di perangkat player: set PAIRING_CODE={code} lalu jalankan pnpm start",
    // player
    playingOn: "Memutar di",
    saveTrack: "Simpan lagu",
    addFavorite: "Tambah ke favorit",
    removeFavorite: "Hapus dari favorit",
    saveToPlaylist: "Simpan ke playlist",
    close: "Tutup",
    noPlaylists: "Belum ada playlist — buat di tab Playlist",
    queue: "Antrian",
    queueEmpty: "Antrian kosong",
    nowPlaying: "Sedang diputar — klik untuk ulang",
    playNow: "Putar sekarang",
    auto: "auto",
    addedToQueue: "Ditambahkan ke queue",
    addedToFav: "Ditambahkan ke favorit",
    removedFromFav: "Dihapus dari favorit",
    addedToPlaylist: "Ditambahkan ke {name}",
    removedFromPlaylist: "Dihapus dari {name}",
    // search
    searchSong: "Cari Lagu",
    playlistFromLink: "Playlist dari Link",
    searchPlaceholder: "Lagu atau artis…",
    search: "Cari",
    noResults: "Tidak ada hasil",
    searchHint: "Ketik judul lagu atau nama artis",
    playLinkTitle: "Putar Playlist dari Link",
    linkPlaceholder: "https://music.youtube.com/playlist?list=…",
    play: "Mainkan",
    loading: "Memuat…",
    addToQueue: "Tambahkan ke queue",
    // login
    username: "Username",
    password: "Password",
    login: "Login",
    loginBusy: "Masuk…",
    // wake
    wake: "Wake (WOL)",
    macPlaceholder: "MAC: 00:D8:61:BD:87:DD",
    // misc
    invalidLink: "Link tidak valid — harus berisi ?list=… (YouTube/YouTube Music)",
    selectDeviceFirst: "Pilih device dulu di panel ⋯",
    // history
    historyTitle: "Riwayat Putar",
    clearAll: "Hapus semua",
    clearAllTitle: "Hapus semua riwayat",
    historyEmpty: "Belum ada riwayat — mulai putar sesuatu",
  },
  en: {
    "tab.search": "Search",
    "tab.playlists": "Playlists",
    "tab.favorites": "Favorites",
    "tab.history": "History",
    menu: "Menu",
    settings: "Settings",
    logout: "Logout",
    selectDeviceHint: "Select a device to start listening",
    settingsTitle: "Settings",
    settingsLanguage: "Language",
    settingsAccount: "Username",
    settingsPassword: "Password",
    settingsPairing: "Pairing Code (new player device)",
    saveUsername: "Save Username",
    savePassword: "Save Password",
    placeholderUsername: "New username (min. 3 chars)",
    placeholderVerifyPw: "Current password (verify)",
    placeholderOldPw: "Old password",
    placeholderNewPw: "New password (min. 6 chars)",
    placeholderConfirmPw: "Repeat new password",
    placeholderDeviceId: "Device ID (e.g. android-tv)",
    create: "Create",
    cancel: "Cancel",
    save: "Save",
    pairingCodeValid: "Code (valid {n} min, single use):",
    pairingInstructions: "On the player device: set PAIRING_CODE={code} then run pnpm start",
    playingOn: "Playing on",
    saveTrack: "Save track",
    addFavorite: "Add to favorites",
    removeFavorite: "Remove from favorites",
    saveToPlaylist: "Save to playlist",
    close: "Close",
    noPlaylists: "No playlists yet — create one in the Playlists tab",
    queue: "Queue",
    queueEmpty: "Queue is empty",
    nowPlaying: "Playing — click to restart",
    playNow: "Play now",
    auto: "auto",
    addedToQueue: "Added to queue",
    addedToFav: "Added to favorites",
    removedFromFav: "Removed from favorites",
    addedToPlaylist: "Added to {name}",
    removedFromPlaylist: "Removed from {name}",
    searchSong: "Search Songs",
    playlistFromLink: "Playlist from Link",
    searchPlaceholder: "Song or artist…",
    search: "Search",
    noResults: "No results",
    searchHint: "Type a song title or artist name",
    playLinkTitle: "Play Playlist from Link",
    linkPlaceholder: "https://music.youtube.com/playlist?list=…",
    play: "Play",
    loading: "Loading…",
    addToQueue: "Add to queue",
    username: "Username",
    password: "Password",
    login: "Login",
    loginBusy: "Signing in…",
    wake: "Wake (WOL)",
    macPlaceholder: "MAC: 00:D8:61:BD:87:DD",
    invalidLink: "Invalid link — must contain ?list=… (YouTube/YouTube Music)",
    selectDeviceFirst: "Select a device first in the ⋯ panel",
    historyTitle: "Play History",
    clearAll: "Clear all",
    clearAllTitle: "Clear all history",
    historyEmpty: "No history yet — start playing something",
  },
};

const saved = localStorage.getItem("mc-lang") as Lang | null;
export const i18n = reactive({ lang: saved === "en" || saved === "id" ? saved : "id" });

export function setLang(lang: Lang): void {
  i18n.lang = lang;
  localStorage.setItem("mc-lang", lang);
}

/** Translate a key; supports {placeholders} via the args object. */
export function t(key: string, args?: Record<string, string | number>): string {
  let s = dict[i18n.lang][key] ?? dict.id[key] ?? key;
  if (args) {
    for (const [k, v] of Object.entries(args)) s = s.split(`{${k}}`).join(String(v));
  }
  return s;
}
