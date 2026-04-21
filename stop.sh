#!/bin/zsh

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
PID_FILE="$ROOT_DIR/.vite-dev.pid"
LOG_FILE="$ROOT_DIR/.vite-dev.log"
PORT="5173"

STOPPED=0

if [[ -f "$PID_FILE" ]]; then
  PID="$(cat "$PID_FILE")"
  if [[ -n "$PID" ]] && kill -0 "$PID" >/dev/null 2>&1; then
    pkill -TERM -P "$PID" >/dev/null 2>&1 || true
    kill -TERM "$PID" >/dev/null 2>&1 || true
    STOPPED=1
  fi
  rm -f "$PID_FILE"
fi

PORT_PIDS="$(lsof -ti tcp:$PORT 2>/dev/null || true)"
if [[ -n "$PORT_PIDS" ]]; then
  for PID in ${(f)PORT_PIDS}; do
    kill -TERM "$PID" >/dev/null 2>&1 || true
    STOPPED=1
  done
fi

if [[ "$STOPPED" -eq 1 ]]; then
  echo "Stopped dev server on port $PORT."
else
  echo "No dev server found on port $PORT."
fi

if [[ -f "$LOG_FILE" ]]; then
  echo "Log file: $LOG_FILE"
fi
