#!/usr/bin/env bash
# Install SearXNG as a user service on 127.0.0.1:8888 and the pi web-search skill.
# Run it on the host from the checkout. It is safe to run again.
# Usage: bash deploy/searxng/install.sh
set -euo pipefail

searxng_commit=54ca1d9cfb08674f66261d7f351b063558dfcc62
here="$(cd "$(dirname "$0")" && pwd)"
home_directory="$HOME/searxng"
settings="$HOME/.config/searxng/settings.yml"
skill_directory="$HOME/.pi/agent/skills/web-search"

if [ ! -d "$home_directory/src" ]; then
  git clone -q https://github.com/searxng/searxng.git "$home_directory/src"
  git -C "$home_directory/src" checkout -q "$searxng_commit"
fi
[ -d "$home_directory/venv" ] || python3 -m venv "$home_directory/venv"
cp "$here/update.sh" "$home_directory/update.sh"
chmod +x "$home_directory/update.sh"
"$home_directory/venv/bin/pip" install -q -U pip setuptools wheel pyyaml msgspec typing_extensions granian
(cd "$home_directory/src" && "$home_directory/venv/bin/pip" install -q --use-pep517 --no-build-isolation -e .)

if [ ! -f "$settings" ]; then
  mkdir -p "$(dirname "$settings")"
  (umask 077 && sed "s|__SECRET_KEY__|$(openssl rand -hex 32)|" "$here/settings.yml" > "$settings")
fi

mkdir -p "$HOME/.config/systemd/user" "$skill_directory"
cp "$here/searxng.service" "$HOME/.config/systemd/user/searxng.service"
cp "$here/SKILL.md" "$skill_directory/SKILL.md"
systemctl --user daemon-reload
systemctl --user enable --now searxng

for attempt in {1..10}; do
  if curl -fsS -o /dev/null "http://127.0.0.1:8888/search?q=test&format=json"; then
    echo "SearXNG: answering on 127.0.0.1:8888"
    exit 0
  fi
  sleep 2
done
journalctl --user -u searxng -n 30 --no-pager
exit 1
