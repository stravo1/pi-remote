#!/usr/bin/env bash
# Check the three services after installation or a reboot.
# Usage: bash deploy/check-services.sh pi.example.com
set -euo pipefail

app_domain="${1:?Pass the app domain, for example pi.example.com}"

for service in authelia pi-remote caddy; do
  systemctl --user is-active --quiet "$service"
  echo "$service: active"
done

curl -fsS -o /dev/null http://127.0.0.1:7710/api/ping
echo "app: 204"
curl -fsS -o /dev/null http://127.0.0.1:9091/api/health
echo "authelia: healthy"
status="$(curl -sS -o /dev/null -w '%{http_code}' \
  --resolve "$app_domain:443:127.0.0.1" "https://$app_domain/")"
case "$status" in
  2??|3??) echo "caddy: $status" ;;
  *) echo "Caddy returned HTTP $status" >&2; exit 1 ;;
esac
