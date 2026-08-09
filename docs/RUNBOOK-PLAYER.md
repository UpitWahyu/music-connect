# Runbook — Music Player Agent

Pasang player di PC/laptop/Android untuk mulai memutar musik dari
Music Connect. Player = agent Node.js ringan yang mengontrol **mpv**;
audio keluar dari perangkat ini, bukan dari server.

```
Web / HP ──wss──▶ music.example.com ──▶ server :3019 ──command──▶ player agent ──▶ mpv ──▶ speaker
```

---

## 1. Prasyarat

| Perangkat | Node.js | pnpm | mpv | yt-dlp |
|---|---|---|---|---|
| Linux | 20+ | 9+ | ✅ `apt install mpv` | ✅ `apt install yt-dlp` |
| Windows | 20+ | 9+ | ✅ `winget install mpv` | ✅ `winget install yt-dlp` |
| macOS | 20+ | 9+ | ✅ `brew install mpv` | ✅ `brew install yt-dlp` |
| Android (Termux) | ✅ `pkg install nodejs` | ✅ `pkg install pnpm` | ✅ `pkg install mpv` | ✅ `pkg install yt-dlp` |

> mpv 0.35+ sudah punya yt-dlp *built-in*; instal yt-dlp terpisah kalau
> resolusi YouTube gagal. Audio di Termux kadang direbut app lain — pakai
> `termux-wake-lock` supaya proses tidak di-suspend.

Cek semua terpasang:

```bash
node -v && pnpm -v && mpv --version | head -1 && yt-dlp --version
```

## 2. Ambil kode player

```bash
git clone https://github.com/your-username/music-connect.git
cd music-connect
pnpm install                     # workspace: types/protocol/shared
pnpm --filter @music-connect/player build
```

> Repo ini private — pastikan GitHub auth sudah aktif di mesin
> (`gh auth login`, atau pakai personal access token).

## 3. Pairing (hanya sekali)

Buat pairing code dari sisi controller (VPS atau PC mana pun yang punya
akses ke server):

```bash
MUSIC_PASSWORD=xxx ./scripts/pair-device.sh desktop
# → Pairing code untuk 'desktop': 123-456 (berlaku 5 menit)
```

Lalu di mesin player, jalankan sekali dengan code itu:

```bash
cd music-connect/apps/player
PAIRING_CODE=123-456 pnpm start
```

Token device tersimpan otomatis di `~/.config/music-player/credentials.json`
(Linux/macOS) atau `%USERPROFILE%\.config\music-player\credentials.json`
(Windows). Jalankan berikutnya tidak perlu pairing lagi.

## 4. Jalankan player (normal)

```bash
cd music-connect/apps/player
pnpm start
```

### Env vars (semua opsional kecuali saat pairing)

| Var | Default | Keterangan |
|---|---|---|
| `MUSIC_SERVER_URL` | `ws://localhost:3000` | **WAJIB untuk remote**: `wss://music.example.com/ws/player` |
| `DEVICE_ID` | `desktop` | ID unik device (tampil di web UI) |
| `DEVICE_NAME` | `Desktop` | Nama ramah (mis. `Living Room`) |
| `DEVICE_TYPE` | `desktop` | `desktop` / `android` / `tv` |
| `PAIRING_CODE` | – | Hanya untuk pairing pertama |
| `MPV_SOCKET` | `/tmp/music-mpv.sock` | Lokasi socket mpv (Windows: named pipe otomatis) |
| `HEARTBEAT_MS` | `5000` | Heartbeat presence |
| `STATE_REPORT_MS` | `2000` | Laporan posisi saat playing |

Contoh:

```bash
MUSIC_SERVER_URL=wss://music.example.com/ws/player \
DEVICE_ID=living-room DEVICE_NAME="Living Room" \
pnpm start
```

## 5. Auto-start (opsional)

**Linux (systemd user):** `~/.config/systemd/user/music-player.service`

```ini
[Unit]
Description=Music Connect Player
After=network-online.target

[Service]
Type=simple
WorkingDirectory=/home/USER/music-connect/apps/player
Environment=MUSIC_SERVER_URL=wss://music.example.com/ws/player
Environment=DEVICE_ID=living-room
ExecStart=/usr/bin/node /home/USER/music-connect/apps/player/dist/index.js
Restart=on-failure
RestartSec=3

[Install]
WantedBy=default.target
```

```bash
systemctl --user daemon-reload
systemctl --user enable --now music-player
```

**Windows:** buat shortcut → `Target: pnpm start` di folder `shell:startup`,
atau pakai Task Scheduler / PM2.

**Android Termux:** jalankan manual (keputusan: tanpa auto-start) —
`termux-wake-lock` sebelum start supaya tidak di-suspend.

## 6. Troubleshooting

| Gejala | Solusi |
|---|---|
| `mpv: command not found` | Install mpv (bagian 1) atau set `PATH` |
| `No credentials found` | Jalankan sekali dengan `PAIRING_CODE` (bagian 3) |
| `INVALID_OR_EXPIRED_CODE` | Code 1× pakai & TTL 5 menit → buat code baru |
| WS error / tidak connect | Cek `MUSIC_SERVER_URL` (harus `wss://.../ws/player`), test `curl https://music.example.com/healthz` |
| Suara tidak keluar | Cek volume mpv (`set_property volume`), audio sink Termux/Windows |
| Lagu tidak bisa resolve | `yt-dlp https://music.youtube.com/watch?v=xxx` manual untuk cek |
| Token hilang/rusak | Hapus `credentials.json` → pairing ulang |
| Update versi | `git pull && pnpm install && pnpm --filter @music-connect/player build && restart` |

## 7. Fitur yang otomatis

- ✅ Reconnect eksponensial (1s → 2s → 4s → maks) kalau WS putus
- ✅ Heartbeat 5s → device tampil 🟢 di web UI
- ✅ Report posisi 2s saat playing (server → semua controller sinkron)
- ✅ Auto-next: lagu selesai → server pilih berikutnya (queue/rekomendasi)
- ✅ Handoff: pindahkan playback ke device ini tanpa restart lagu
