#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/OpenTree}"
DATA_DIR="${DATA_DIR:-/var/lib/opentree}"
GITHUB_TOKEN="${GITHUB_TOKEN:-}"

if [ "$(id -u)" -ne 0 ]; then
  echo "Ejecuta este actualizador como root."
  exit 1
fi

if [ -d "$DATA_DIR" ]; then
  BACKUP_DIR="$DATA_DIR/backups/$(date +%Y%m%d-%H%M%S)"
  mkdir -p "$BACKUP_DIR"
  for file in config.json project.json pending-project-changes.json; do
    if [ -f "$DATA_DIR/$file" ]; then
      cp "$DATA_DIR/$file" "$BACKUP_DIR/$file"
    fi
  done
  echo "Copia de seguridad de datos: $BACKUP_DIR"
fi

if [ -n "$GITHUB_TOKEN" ]; then
  git -C "$APP_DIR" -c http.extraHeader="Authorization: Bearer $GITHUB_TOKEN" pull origin main
else
  git -C "$APP_DIR" pull origin main
fi

cd "$APP_DIR"
npm ci
npm run build
systemctl restart opentree
systemctl status opentree --no-pager
