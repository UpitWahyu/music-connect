#!/usr/bin/env bash
# Generate a pairing code for a new Music Connect player device.
#
# Usage:
#   MUSIC_PASSWORD=xxx ./scripts/pair-device.sh <device-id> [server-url]
#
# Env: MUSIC_USERNAME (default: admin), MUSIC_PASSWORD (required)
# Requires: curl + node (or python3)
set -euo pipefail

SERVER="${2:-https://YOUR_SERVER}"
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

echo "→ Logging in to $SERVER ..."
TOKEN="$(curl -fsS -X POST "$SERVER/api/auth/login" \
  -H 'content-type: application/json' \
  -d "{\"username\":\"$USERNAME\",\"password\":\"$PASSWORD\"}" | parse_json token)"

echo "→ Generating pairing code for '$DEVICE_ID' ..."
CODE="$(curl -fsS -X POST "$SERVER/api/devices/$DEVICE_ID/pair" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -d '{}' | parse_json pairingCode)"

echo
echo "════════════════════════════════════════════════"
echo "  Pairing code:  $CODE"
echo "  Valid 5 minutes, single use."
echo "════════════════════════════════════════════════"
echo
echo "On the player machine, run:"
echo "  cd music-connect/apps/player"
echo "  MUSIC_SERVER_URL=wss://YOUR_SERVER/ws/player PAIRING_CODE=$CODE pnpm start"
