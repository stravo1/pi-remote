#!/usr/bin/env bash
# Add a CI deploy public key to authorized_keys so GitHub Actions can deploy.
# Usage, on the host, from a checkout of this repository:
#   bash deploy/deploy-key.sh deploy/deploy_key.pub
# The forced command runs receive.sh in this checkout, so CI deploys land in
# the same checkout the service serves. Running it again replaces the key.
set -euo pipefail

directory="$(cd "$(dirname "$0")/.." && pwd)"
pubkey_file="${1:-}"

if [ -z "$pubkey_file" ] || [ ! -f "$pubkey_file" ]; then
  echo "Usage: bash deploy/deploy-key.sh <deploy_key.pub>" >&2
  exit 1
fi

pubkey="$(head -n 1 "$pubkey_file")"
case "$pubkey" in
  ssh-ed25519\ *|ssh-rsa\ *|ecdsa-sha2-*\ *) ;;
  *) echo "Error: $pubkey_file does not look like a public key." >&2; exit 1 ;;
esac

mkdir -p "$HOME/.ssh"
chmod 700 "$HOME/.ssh"
if [ ! -f "$HOME/.ssh/authorized_keys" ]; then
  install -m 600 /dev/null "$HOME/.ssh/authorized_keys"
fi

# Keep one deploy key line: drop every older force-command line for receive.sh
# in any checkout, then add the current one. An empty file is harmless.
grep -v 'command=.*deploy/receive.sh' "$HOME/.ssh/authorized_keys" >"$HOME/.ssh/authorized_keys.next" || true
cp "$HOME/.ssh/authorized_keys.next" "$HOME/.ssh/authorized_keys"
rm "$HOME/.ssh/authorized_keys.next"
printf 'restrict,command="%s/deploy/receive.sh" %s pi-remote-ci\n' "$directory" "$pubkey" \
  >>"$HOME/.ssh/authorized_keys"

echo "Deploy key installed. CI deploys now install into $directory."
