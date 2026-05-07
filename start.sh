#!/bin/zsh

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
PID_FILE="$ROOT_DIR/.vite-dev.pid"
LOG_FILE="$ROOT_DIR/.vite-dev.log"
CERT_DIR="$ROOT_DIR/.cert"
KEY_FILE="$CERT_DIR/dev-key.pem"
CERT_FILE="$CERT_DIR/dev-cert.pem"
PORT="5173"
SCHEME="https"

get_ip() {
  ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true
}

ensure_cert() {
  local lan_ip="$1"

  mkdir -p "$CERT_DIR"

  if [[ -f "$KEY_FILE" && -f "$CERT_FILE" ]]; then
    return
  fi

  local cfg_file="$CERT_DIR/openssl.cnf"
  cat > "$cfg_file" <<EOF
[req]
default_bits = 2048
prompt = no
default_md = sha256
distinguished_name = dn
x509_extensions = v3_req

[dn]
CN = localhost

[v3_req]
subjectAltName = @alt_names

[alt_names]
DNS.1 = localhost
IP.1 = 127.0.0.1
EOF

  if [[ -n "$lan_ip" ]]; then
    cat >> "$cfg_file" <<EOF
IP.2 = $lan_ip
EOF
  fi

  openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
    -keyout "$KEY_FILE" \
    -out "$CERT_FILE" \
    -config "$cfg_file" >/dev/null 2>&1
}

if lsof -ti tcp:"$PORT" >/dev/null 2>&1; then
  echo "Port $PORT is already in use. Run ./stop.sh first or free the port."
  exit 1
fi

cd "$ROOT_DIR"

LAN_IP="$(get_ip)"
ensure_cert "$LAN_IP"

if command -v setsid >/dev/null 2>&1; then
  VITE_DEV_HTTPS=true VITE_DEV_HTTPS_KEY="$KEY_FILE" VITE_DEV_HTTPS_CERT="$CERT_FILE" \
    setsid npm run dev -- --host 0.0.0.0 --port "$PORT" --strictPort < /dev/null > "$LOG_FILE" 2>&1 &
else
  VITE_DEV_HTTPS=true VITE_DEV_HTTPS_KEY="$KEY_FILE" VITE_DEV_HTTPS_CERT="$CERT_FILE" \
    nohup npm run dev -- --host 0.0.0.0 --port "$PORT" --strictPort < /dev/null > "$LOG_FILE" 2>&1 &
fi

SERVER_PID=$!
echo "$SERVER_PID" > "$PID_FILE"

sleep 2

if ! kill -0 "$SERVER_PID" >/dev/null 2>&1; then
  echo "Failed to start dev server."
  rm -f "$PID_FILE"
  cat "$LOG_FILE"
  exit 1
fi

if ! curl -kfsS "$SCHEME://localhost:$PORT" >/dev/null 2>&1; then
  echo "Server process started but localhost check failed."
  cat "$LOG_FILE"
  exit 1
fi

echo "Dev server started."
echo "Local:   $SCHEME://localhost:$PORT/"
if [[ -n "$LAN_IP" ]]; then
  echo "Network: $SCHEME://$LAN_IP:$PORT/"
  if curl -kfsS "$SCHEME://$LAN_IP:$PORT" >/dev/null 2>&1; then
    echo "Network check: OK"
  else
    echo "Network check: FAILED from this Mac"
  fi
else
  echo "Network IP not detected automatically."
fi
echo "Nota: sul telefono potrebbe essere necessario accettare il certificato locale prima di usare fotocamera o sensori."
echo "Log:     $LOG_FILE"
echo "Stop it with: ./stop.sh"
