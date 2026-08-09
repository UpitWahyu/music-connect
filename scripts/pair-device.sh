#!/usr/bin/env bash
# Generate a pairing code for a new Music Connect player device.
#
# Usage:
#   MUSIC_PASSWORD=xxx ./scripts/pair-device.sh <device-id> [server-url]
#
# Env: MUSIC_USERNAME (default admin), MUSIC_PASSWORD (required)
# Requires: curl + node (or python3)
set -euo pipefail

SERVER="${2:-https://music.example.com}"
DEVICE_ID="${1:?Usage: pair-device.sh <device-id> [server-url]}"
USERNAME="${MUSIC_USERNAME:-admin}"
PASSWORD="${MUSIC_PASSWORD:?Set MUSIC_PASSWORD env, e.g. MUSIC_PASSWORD=xxx ./scripts/pair-device.sh desktop}"

parse_json() {
  if command -v node >/dev/null 2>&1; then
    node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d)[process.argv[1]]))" "$1"
  else
    python3 -c "import sys,json;print(json.load(sys.stdin)[sys.argv[1]])" "$1"
  fi
}

echo "→ Login ke $SERVER ..."
TOKEN="$(curl -fsS -X POST "$SERVER/api/auth/login" \
  -H 'content-type: application/json' \
  -d "{\"username\":\"$USERNAME\",\"password\":\"$PASSWORD\"}" | parse_json token)"

echo "→ Generate pairing code untuk '$DEVICE_ID' ..."
CODE="$(curl -fsS -X POST "$SERVER/api/devices/$DEVICE_ID/pair" \
  -H "Authorization: Bearer $TOKEN" | parse_json pairingCode)"

echo
echo "════════════════════════════════════════════════"
echo "  Pairing code:  $CODE"
echo "  Berlaku 5 menit, sekali pakai."
echo "════════════════════════════════════════════════"
echo
echo "Jalankan di mesin player:"
echo "  cd music-connect/apps/player"
echo "  MUSIC_SERVER_URL=wss://music.example.com/ws/player PAIRING_CODE=$CODE pnpm start"
