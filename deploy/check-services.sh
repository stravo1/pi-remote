#!/usr/bin/env bash
# Check the three services after installation or a reboot.
# Usage: bash deploy/check-services.sh pi.example.com
set -euo pipefail

app_domain="${1:?Pass the app domain, for example pi.example.com}"

for service in authelia pi-remote caddy; do
  systemctl --user is-active --quiet "$service"
  echo "$service: active"
done

wait_for_url() {
  local label="$1"
  local url="$2"
  for attempt in {1..10}; do
    if curl -fsS -o /dev/null "$url"; then
      echo "$label"
      return
    fi
    sleep 2
  done
  echo "$label did not become ready" >&2
  return 1
}

wait_for_url "app: 204" http://127.0.0.1:7710/api/ping
wait_for_url "authelia: healthy" http://127.0.0.1:9091/api/health

for attempt in {1..10}; do
  status="$(curl -sS -o /dev/null -w '%{http_code}' \
    --resolve "$app_domain:443:127.0.0.1" "https://$app_domain/" || true)"
  case "$status" in
    2??|3??) echo "caddy: $status"; exit 0 ;;
  esac
  sleep 2
done
echo "Caddy did not become ready" >&2
exit 1
