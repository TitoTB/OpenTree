#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/OpenTree}"
GITHUB_TOKEN="${GITHUB_TOKEN:-}"

if [ "$(id -u)" -ne 0 ]; then
  echo "Ejecuta este actualizador como root."
  exit 1
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
