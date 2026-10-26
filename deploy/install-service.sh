#!/usr/bin/env bash
# Install all pi-remote systemd user services. Run it on the host from the checkout.
# Usage: bash deploy/install-service.sh
set -euo pipefail

directory="$(cd "$(dirname "$0")/.." && pwd)"
node_path="$(command -v node)"
authelia_path="$HOME/.local/bin/authelia"
caddy_path="$HOME/.local/bin/caddy"
authelia_config="$HOME/.config/authelia/configuration.yml"
caddy_config="$HOME/.config/pi-remote/Caddyfile"
unit_directory="$HOME/.config/systemd/user"

[ -f "$directory/config.local.json" ] || { echo "Missing $directory/config.local.json" >&2; exit 1; }
[ -x "$authelia_path" ] || { echo "Missing $authelia_path" >&2; exit 1; }
[ -x "$caddy_path" ] || { echo "Missing $caddy_path" >&2; exit 1; }
[ -f "$authelia_config" ] || { echo "Missing $authelia_config" >&2; exit 1; }
[ -f "$caddy_config" ] || { echo "Missing $caddy_config" >&2; exit 1; }

if ! systemctl --user is-active --quiet pi-remote \
  && curl -fsS -o /dev/null http://127.0.0.1:7710/api/ping 2>/dev/null; then
  echo "Port 7710 is in use. Stop the hand-started server first." >&2
  exit 1
fi

"$authelia_path" config validate --config "$authelia_config"
"$caddy_path" validate --config "$caddy_config" --adapter caddyfile

mkdir -p "$unit_directory"
sed -e "s|__DIRECTORY__|$directory|g" -e "s|__NODE__|$node_path|g" \
  "$directory/deploy/pi-remote.service" > "$unit_directory/pi-remote.service"
sed -e "s|__AUTHELIA__|$authelia_path|g" -e "s|__AUTHELIA_CONFIG__|$authelia_config|g" \
  "$directory/deploy/authelia.service" > "$unit_directory/authelia.service"
sed -e "s|__CADDY__|$caddy_path|g" -e "s|__CADDY_CONFIG__|$caddy_config|g" \
  "$directory/deploy/caddy.service" > "$unit_directory/caddy.service"
sudo loginctl enable-linger "$USER"
systemctl --user daemon-reload
systemctl --user enable authelia pi-remote caddy
systemctl --user start authelia pi-remote caddy
systemctl --user --no-pager status authelia pi-remote caddy
