#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/OpenTree}"
DATA_DIR="${DATA_DIR:-/var/lib/opentree}"
REPO_URL="${REPO_URL:-https://github.com/TitoTB/OpenTree.git}"
SERVICE_FILE="/etc/systemd/system/opentree.service"
PORT="${PORT:-8080}"

if [ "$(id -u)" -ne 0 ]; then
  echo "Ejecuta este instalador como root."
  exit 1
fi

apt update
apt install -y ca-certificates curl gnupg git

if ! command -v node >/dev/null 2>&1 || ! node -e "process.exit(Number(process.versions.node.split('.')[0]) >= 20 ? 0 : 1)" >/dev/null 2>&1; then
  echo "Instalando Node.js 22..."
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt install -y nodejs
fi

if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" pull origin main
else
  rm -rf "$APP_DIR"
  git clone "$REPO_URL" "$APP_DIR"
fi

mkdir -p "$DATA_DIR"

cd "$APP_DIR"
npm ci
npm run build

cat > "$SERVICE_FILE" <<SERVICE
[Unit]
Description=OpenTree genealogy app
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=$APP_DIR
Environment=NODE_ENV=production
Environment=PORT=$PORT
Environment=OPENTREE_DATA_DIR=$DATA_DIR
ExecStart=/usr/bin/npm run start
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
SERVICE

systemctl daemon-reload
systemctl enable opentree
systemctl restart opentree

echo
echo "OpenTree instalado."
echo "Abre: http://IP_DEL_SERVIDOR:$PORT"
echo "Datos: $DATA_DIR"
echo "Logs: journalctl -u opentree -f"
