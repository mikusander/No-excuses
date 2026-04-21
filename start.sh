#!/bin/zsh

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
PID_FILE="$ROOT_DIR/.vite-dev.pid"
LOG_FILE="$ROOT_DIR/.vite-dev.log"
PORT="5173"

get_ip() {
  ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true
}

if lsof -ti tcp:"$PORT" >/dev/null 2>&1; then
  echo "Port $PORT is already in use. Run ./stop.sh first or free the port."
  exit 1
fi

cd "$ROOT_DIR"

nohup npm run dev -- --host 0.0.0.0 --port "$PORT" --strictPort > "$LOG_FILE" 2>&1 &
SERVER_PID=$!
echo "$SERVER_PID" > "$PID_FILE"

sleep 2

if ! kill -0 "$SERVER_PID" >/dev/null 2>&1; then
  echo "Failed to start dev server."
  rm -f "$PID_FILE"
  cat "$LOG_FILE"
  exit 1
fi

LAN_IP="$(get_ip)"

echo "Dev server started."
echo "Local:   http://localhost:$PORT/"
if [[ -n "$LAN_IP" ]]; then
  echo "Network: http://$LAN_IP:$PORT/"
else
  echo "Network IP not detected automatically."
fi
echo "Log:     $LOG_FILE"
echo "Stop it with: ./stop.sh"
