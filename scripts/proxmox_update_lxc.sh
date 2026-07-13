#!/usr/bin/env bash
set -euo pipefail

CTID="${CTID:-}"
HOSTNAME="${HOSTNAME:-OpenTree}"
APP_DIR="${APP_DIR:-/opt/OpenTree}"
GITHUB_TOKEN="${GITHUB_TOKEN:-}"

if [ "$(id -u)" -ne 0 ]; then
  echo "Ejecuta este script como root en el host Proxmox."
  exit 1
fi

if ! command -v pct >/dev/null 2>&1; then
  echo "No encuentro 'pct'. Este script debe ejecutarse en el host Proxmox."
  exit 1
fi

if [ -z "$CTID" ]; then
  CTID="$(pct list | awk -v name="$HOSTNAME" 'tolower($3) == tolower(name) {print $1; exit}')"
fi

if [ -z "$CTID" ]; then
  echo "No encuentro un LXC llamado $HOSTNAME."
  echo "Indica el ID manualmente: CTID=123 bash -c \"\$(curl -fsSL URL)\""
  pct list
  exit 1
fi

echo "Actualizando OpenTree en CTID=$CTID..."
if [ -n "$GITHUB_TOKEN" ]; then
  pct exec "$CTID" -- env GITHUB_TOKEN="$GITHUB_TOKEN" APP_DIR="$APP_DIR" bash -lc '
    set -euo pipefail
    git -C "$APP_DIR" -c http.extraHeader="Authorization: Bearer $GITHUB_TOKEN" pull origin main
    cd "$APP_DIR"
    npm ci
    npm run build
    systemctl restart opentree
    systemctl status opentree --no-pager
  '
else
  pct exec "$CTID" -- env APP_DIR="$APP_DIR" bash -lc "bash $APP_DIR/scripts/update_debian.sh"
fi

IP="$(pct exec "$CTID" -- bash -lc "hostname -I | awk '{print \$1}'" | tr -d '\r')"
echo
echo "OpenTree actualizado."
echo "URL: http://$IP:8080"
