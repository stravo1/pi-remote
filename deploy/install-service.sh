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

# The CI deploy key must run receive.sh in this checkout, so deploys land
# where the service is served.
warn_when_deploy_key_drifted() {
  local line key_target
  line="$(grep 'command=.*deploy/receive.sh' "$HOME/.ssh/authorized_keys" 2>/dev/null | head -n 1 || true)"
  # No key (fresh host) is fine; `return` alone would inherit the test's rc 1 and fail the install.
  [ -n "$line" ] || return 0
  key_target="$(sed 's/.*command="\([^"]*\).*/\1/' <<<"$line")"
  if [ "$key_target" != "$directory/deploy/receive.sh" ]; then
    echo
    echo "Warning: the CI deploy key runs $key_target,"
    echo "but the service runs $directory."
    echo "Deploys will not reach the served checkout."
    echo "Repair it with: bash deploy/deploy-key.sh <deploy_key.pub>"
  fi
}

mkdir -p "$unit_directory"
# Units are rendered to temp files and installed only when they differ from what is
# installed. A service whose unit changed is restarted below: `start` on an active
# service is a no-op, and systemd applies no new Environment to a running process.
changed=()
maybe_install() {
  local service="$1" rendered="$2"
  local destination="$unit_directory/$service.service"
  if cmp -s "$rendered" "$destination"; then
    rm -f "$rendered"
    return
  fi
  mv -f "$rendered" "$destination"
  changed+=("$service")
}

sed -e "s|__DIRECTORY__|$directory|g" -e "s|__NODE__|$node_path|g" \
  "$directory/deploy/pi-remote.service" > "$unit_directory/pi-remote.service.tmp"
maybe_install pi-remote "$unit_directory/pi-remote.service.tmp"
sed -e "s|__AUTHELIA__|$authelia_path|g" -e "s|__AUTHELIA_CONFIG__|$authelia_config|g" \
  "$directory/deploy/authelia.service" > "$unit_directory/authelia.service.tmp"
maybe_install authelia "$unit_directory/authelia.service.tmp"
sed -e "s|__CADDY__|$caddy_path|g" -e "s|__CADDY_CONFIG__|$caddy_config|g" \
  "$directory/deploy/caddy.service" > "$unit_directory/caddy.service.tmp"
maybe_install caddy "$unit_directory/caddy.service.tmp"

sudo loginctl enable-linger "$USER"
systemctl --user daemon-reload
systemctl --user enable authelia pi-remote caddy
systemctl --user start authelia pi-remote caddy
for service in "${changed[@]}"; do
  echo "Restarting $service: its unit changed."
  systemctl --user restart "$service"
done
systemctl --user --no-pager status authelia pi-remote caddy
warn_when_deploy_key_drifted
