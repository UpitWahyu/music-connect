#!/usr/bin/env bash
#
# termux-autostart.sh
# ─────────────────────────────────────────────────────────────────────────────
# Auto-connect / auto-restart untuk agen player Music Connect di Termux (Android).
#
# Skrip ini:
#   1. Mengambil Termux wake lock (agar Android Doze tidak mematikan WiFi saat
#      layar mati).
#   2. pindah ke direktori repo music-connect.
#   3. (Opsional, AUTO_UPDATE=1) self-update via git + rebuild.
#   4. Memastikan protocol + player sudah di-build (coba ulang sampai 2x).
#   5. Menjalankan player dalam loop supervisor auto-restart tanpa henti, dengan
#      batas restart untuk menghindari crash-loop ketat.
#   6. Mengirim notifikasi Termux saat mulai dan saat berhenti fatal.
#   7. Menangkap SIGINT/SIGTERM untuk keluar bersih (lepas wake lock, bunuh child).
#
# Environment variables (semua opsional):
#   MUSIC_DIR           Direktori repo music-connect. Default: $HOME/music-connect
#   AUTO_UPDATE         Isi "1" untuk self-update + rebuild otomatis. Default: off (0)
#   MAX_RESTARTS        Batas restart dalam window waktu. Default: 20
#   RESTART_WINDOW_SEC  Window waktu hitungan restart (detik). Default: 600 (10 mnt)
#   PLAYER_START_CMD    Perintah menjalankan player.
#                       Default: pnpm --filter @music-connect/player start
#   BUILD_RETRIES       Jumlah ulang build saat gagal. Default: 2
#
# Contoh:
#   ./termux-autostart.sh
#   MUSIC_DIR=/data/data/com.termux/files/home/mc AUTO_UPDATE=1 ./termux-autostart.sh
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

# ---- Konfigurasi & nilai default --------------------------------------------
MUSIC_DIR="${MUSIC_DIR:-$HOME/music-connect}"
AUTO_UPDATE="${AUTO_UPDATE:-0}"
MAX_RESTARTS="${MAX_RESTARTS:-20}"
RESTART_WINDOW_SEC="${RESTART_WINDOW_SEC:-600}"
PLAYER_START_CMD="${PLAYER_START_CMD:-pnpm --filter @music-connect/player start}"
BUILD_RETRIES="${BUILD_RETRIES:-2}"

NOTIF_ID="music-connect"
NOTIF_TITLE="Music Connect"

# ---- Helper notifikasi ------------------------------------------------------
# Kirim notifikasi Termux bila tersedia, kalau tidak cukup ke log.
notify() {
  local title="$1"
  local body="$2"
  if command -v termux-notification >/dev/null 2>&1; then
    termux-notification --id "$NOTIF_ID" --title "$title" --content "$body" >/dev/null 2>&1 || true
  else
    echo "[notify] $title: $body"
  fi
}

# ---- Wake lock --------------------------------------------------------------
acquire_wake_lock() {
  if command -v termux-wake-lock >/dev/null 2>&1; then
    termux-wake-lock || echo "[warn] Gagal mengambil wake lock, lanjut anyway." >&2
  else
    echo "[warn] 'termux-wake-lock' tidak ditemukan (perlu Termux:API). Lanjut tanpa wake lock." >&2
  fi
}

release_wake_lock() {
  if command -v termux-wake-lock >/dev/null 2>&1; then
    termux-wake-lock release >/dev/null 2>&1 || true
  fi
}

# ---- Pindah ke direktori repo ----------------------------------------------
if [ ! -d "$MUSIC_DIR" ]; then
  echo "[error] Direktori '$MUSIC_DIR' tidak ditemukan. Atur MUSIC_DIR ke lokasi repo." >&2
  exit 1
fi
cd "$MUSIC_DIR" || exit 1
echo "→ Bekerja di: $MUSIC_DIR"

# ---- (Opsional) Self-update -------------------------------------------------
if [ "$AUTO_UPDATE" = "1" ]; then
  echo "→ Self-update diaktifkan (AUTO_UPDATE=1)..."
  if command -v git >/dev/null 2>&1; then
    git fetch origin || echo "[warn] git fetch gagal, lanjut tanpa update." >&2
    git reset --hard origin/main || echo "[warn] git reset gagal, lanjut dengan kode lokal." >&2
  else
    echo "[warn] 'git' tidak tersedia, lewati self-update." >&2
  fi
fi

# ---- Build protocol + player (coba ulang saat gagal) -----------------------
build_all() {
  echo "→ Build @music-connect/protocol ..."
  pnpm --filter @music-connect/protocol build && \
  echo "→ Build @music-connect/player ..." && \
  pnpm --filter @music-connect/player build
}

attempt=0
while [ "$attempt" -le "$BUILD_RETRIES" ]; do
  if build_all; then
    echo "✓ Build berhasil."
    break
  fi
  attempt=$((attempt + 1))
  if [ "$attempt" -le "$BUILD_RETRIES" ]; then
    echo "[warn] Build gagal (percobaan $attempt/$BUILD_RETRIES), coba lagi dalam 5 detik..." >&2
    sleep 5
  else
    echo "[error] Build gagal setelah $BUILD_RETRIES percobaan. Berhenti." >&2
    notify "$NOTIF_TITLE" "Build gagal — player tidak bisa dijalankan."
    exit 1
  fi
done

# ---- Ambil wake lock sebelum menjalankan player ----------------------------
acquire_wake_lock

# ---- Loop supervisor auto-restart ------------------------------------------
# Catat waktu tiap restart; jika melebihi MAX_RESTARTS dalam RESTART_WINDOW_SEC,
# berhenti (hindari crash-loop ketat) dan kirim notifikasi fatal.
PLAYER_PID=""
declare -a RESTART_TIMES=()
backoff=3

# Bersihkan saat menerima sinyal berhenti.
cleanup_and_exit() {
  echo
  echo "→ Menerima sinyal berhenti, membersihkan..."
  if [ -n "$PLAYER_PID" ] && kill -0 "$PLAYER_PID" 2>/dev/null; then
    kill "$PLAYER_PID" 2>/dev/null || true
    wait "$PLAYER_PID" 2>/dev/null || true
  fi
  release_wake_lock
  exit 0
}
trap cleanup_and_exit INT TERM

echo "→ Memulai player (auto-restart aktif)..."
notify "$NOTIF_TITLE" "Player agent berjalan di Termux."

while true; do
  now=$(date +%s)

  # Buang timestamp yang sudah lewat window.
  pruned=()
  for t in "${RESTART_TIMES[@]}"; do
    if [ $((now - t)) -lt "$RESTART_WINDOW_SEC" ]; then
      pruned+=("$t")
    fi
  done
  RESTART_TIMES=("${pruned[@]}")

  if [ "${#RESTART_TIMES[@]}" -ge "$MAX_RESTARTS" ]; then
    msg="Player crash ${MAX_RESTARTS}x dalam ${RESTART_WINDOW_SEC}s — berhenti untuk hindari crash-loop."
    echo "[fatal] $msg" >&2
    notify "$NOTIF_TITLE" "$msg"
    release_wake_lock
    exit 1
  fi
  RESTART_TIMES+=("$now")

  echo "→ Menjalankan player (restart ke-${#RESTART_TIMES[@]})..."
  # Jalankan perintah start (bisa multi-kata) di background.
  read -ra PLAYER_CMD_ARR <<< "$PLAYER_START_CMD"
  "${PLAYER_CMD_ARR[@]}" &
  PLAYER_PID=$!
  wait "$PLAYER_PID"
  code=$?
  PLAYER_PID=""

  if [ "$code" -ne 0 ]; then
    echo "[warn] Player keluar dengan kode $code, restart dalam ${backoff}s..." >&2
  else
    echo "[warn] Player berhenti (kode 0), restart dalam ${backoff}s..."
  fi

  sleep "$backoff"
  # Backoff eksponensial, dibatasi maksimal 30 detik.
  backoff=$((backoff * 2))
  [ "$backoff" -gt 30 ] && backoff=30
done
