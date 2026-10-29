#!/usr/bin/env bash
# Forced command for the CI deploy key. Reads a tar of the build on stdin, installs it,
# re-renders the app unit, restarts the service, checks health, and replaces itself from
# the deploy it just received. It is shipped in the tar too; the copy runs on the next push.
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
if [ -d "$staging/deploy" ]; then
  # receive.sh is protected from the copy and the delete until the self-replace below:
  # overwriting the file a running bash reads from can corrupt what it has not read yet.
  mkdir -p "$directory/deploy"
  rsync -a --delete --exclude=receive.sh "$staging/deploy/" "$directory/deploy/"
fi

# Re-render the app unit when its template changed, so unit changes deploy with the build.
node_path="$(command -v node)"
tmp_unit="$(mktemp)"
sed -e "s|__DIRECTORY__|$directory|g" -e "s|__NODE__|$node_path|g" \
  "$directory/deploy/pi-remote.service" > "$tmp_unit"
unit="$HOME/.config/systemd/user/pi-remote.service"
if ! cmp -s "$tmp_unit" "$unit"; then
  echo "The installed unit changed. Rerendering it."
  mkdir -p "${unit%/*}"
  mv -f "$tmp_unit" "$unit"
  systemctl --user daemon-reload
fi
rm -f "$tmp_unit"

cd "$directory"
npm ci --omit=dev --workspace server
systemctl --user restart pi-remote
for attempt in 1 2 3 4 5 6 7 8 9 10; do
  curl -fsS -o /dev/null http://127.0.0.1:7710/api/ping && break
  [ "$attempt" -eq 10 ] && break
  sleep 2
done
if curl -fsS -o /dev/null http://127.0.0.1:7710/api/ping; then
  # Replace this script only after the health check, via rename, so the running copy is safe.
  if [ -f "$staging/deploy/receive.sh" ] && ! cmp -s "$staging/deploy/receive.sh" "$directory/deploy/receive.sh"; then
    install -m 755 "$staging/deploy/receive.sh" "$directory/deploy/receive.sh.new"
    mv -f "$directory/deploy/receive.sh.new" "$directory/deploy/receive.sh"
    echo "receive.sh updated; it runs on the next push."
  fi
  echo "Deployed."
  exit 0
fi
journalctl --user -u pi-remote -n 30 --no-pager
exit 1
