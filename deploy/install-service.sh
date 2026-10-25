#!/usr/bin/env bash
# Install the pi-remote systemd user service. Run it on the host from the checkout.
# Usage: bash deploy/install-service.sh
set -euo pipefail

directory="$(cd "$(dirname "$0")/.." && pwd)"
node_path="$(command -v node)"
unit_directory="$HOME/.config/systemd/user"

[ -f "$directory/config.local.json" ] || { echo "Missing $directory/config.local.json" >&2; exit 1; }
if curl -fsS -o /dev/null http://127.0.0.1:7710/api/ping 2>/dev/null; then
  echo "Port 7710 is in use. Stop the hand-started server first." >&2
  exit 1
fi

mkdir -p "$unit_directory"
sed -e "s|__DIRECTORY__|$directory|g" -e "s|__NODE__|$node_path|g" \
  "$directory/deploy/pi-remote.service" > "$unit_directory/pi-remote.service"
sudo loginctl enable-linger "$USER"
systemctl --user daemon-reload
systemctl --user enable --now pi-remote
systemctl --user --no-pager status pi-remote
