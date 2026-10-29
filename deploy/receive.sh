#!/usr/bin/env bash
# Forced command for the CI deploy key. Reads a tar of the build on stdin, installs it,
# restarts the service, and checks health. Install it once, then do not ship it with a deploy.
set -euo pipefail

# sshd gives a restricted command a minimal PATH. easy-install links npm and node in
# ~/.local/bin, so add it here instead of relying on the login profile.
PATH="$HOME/.local/bin:$PATH"
export PATH

directory="$(cd "$(dirname "$0")/.." && pwd)"
staging="$(mktemp -d)"
trap 'rm -rf "$staging"' EXIT

tar -x --no-same-owner -C "$staging"
[ -f "$staging/server/src/main.ts" ] && [ -f "$staging/web/dist/index.html" ] || { echo "Incomplete build." >&2; exit 1; }

rsync -a --delete "$staging/server/src/" "$directory/server/src/"
rsync -a --delete "$staging/web/dist/" "$directory/web/dist/"
cp "$staging/package.json" "$staging/package-lock.json" "$directory/"
cp "$staging/server/package.json" "$directory/server/"
cp "$staging/web/package.json" "$directory/web/"

cd "$directory"
npm ci --omit=dev --workspace server
systemctl --user restart pi-remote
for attempt in 1 2 3 4 5 6 7 8 9 10; do
  curl -fsS -o /dev/null http://127.0.0.1:7710/api/ping && { echo "Deployed."; exit 0; }
  sleep 2
done
journalctl --user -u pi-remote -n 30 --no-pager
exit 1
