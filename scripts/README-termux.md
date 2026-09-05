# Music Connect — Player Agent di Termux (Android)

Skrip `termux-autostart.sh` menjaga agen player Music Connect tetap nyala di
ponsel: mengunci WiFi agar tidak dimatikan Doze, mem-build ulang bila perlu, dan
menjalankan player dalam loop auto-restart yang otomatis memulai ulang bila
player crash/keluar.

## Instalasi di ponsel

1. **Siapkan Termux + Termux:API**
   - Pasang **Termux** dan **Termux:API** dari GitHub (build F-Droid bentrok
     dengan Android 15).
   - Di Termux: `pkg update && pkg install git nodejs pnpm termux-api`.

2. **Ambil repo ke `~/music-connect`**
   ```bash
   git clone <repo-url> ~/music-connect
   cd ~/music-connect
   pnpm install
   ```

3. **Salin & beri hak eksekusi skrip**
   ```bash
   cp scripts/termux-autostart.sh ~/music-connect/
   chmod +x ~/music-connect/termux-autostart.sh
   ```

4. **Pairing sekali saja** (butuh `credentials.json` di
   `~/.config/music-player/credentials.json`, mode 600):
   ```bash
   MUSIC_PASSWORD=xxx ./scripts/pair-device.sh <device-id> https://music.netw.my.id
   ```

5. **Jalankan**
   ```bash
   ~/music-connect/termux-autostart.sh
   ```

## Environment variables (opsional)

| Var                | Default                                  | Keterangan                                   |
|--------------------|------------------------------------------|----------------------------------------------|
| `MUSIC_DIR`        | `$HOME/music-connect`                    | Lokasi repo.                                 |
| `AUTO_UPDATE`      | `0`                                      | Isi `1` untuk `git pull` + rebuild otomatis. |
| `MAX_RESTARTS`     | `20`                                     | Batas restart per window (cegah crash-loop). |
| `RESTART_WINDOW_SEC` | `600`                                  | Window waktu hitungan restart (detik).       |

Contoh dengan auto-update:
```bash
AUTO_UPDATE=1 ~/music-connect/termux-autostart.sh
```

## Jalankan otomatis (boot / widget)

- **Termux:Widget** — taruh skrip di `~/.shortcuts/` lalu tambahkan shortcut
  widget ke layar utama:
  ```bash
  mkdir -p ~/.shortcuts
  ln -s ~/music-connect/termux-autostart.sh ~/.shortcuts/music-connect
  ```
- **Boot otomatis** — gabungkan dengan `termux-boot` + `termux-wake-lock`, atau
  jalankan skrip dari `~/.termux/boot/`.

## ⚠️ Pengaturan baterai (PENTING)

Agar player tidak dibunuh oleh sistem:
- **Setelan → Aplikasi → Termux → Baterai → Optimasi baterai → Tidak
  dioptimasi (Unrestricted).**
- Di Termux sendiri jalankan `termux-wake-lock` (sudah otomatis dilakukan skrip)
  supaya WiFi tetap hidup saat layar mati.

## Hentikan

Tekan `Ctrl+C` di Termux (atau kirim `SIGTERM`). Skrip akan melepas wake lock dan
mematikan player dengan bersih.
