#!/usr/bin/env bash
set -euo pipefail
umask 077

if [ "$#" -lt 2 ] || [ "$#" -gt 3 ]; then
  echo "Usage: set-authelia-password.sh USERNAME NOTIFICATION_EMAIL [CONFIGURATION_DIRECTORY]" >&2
  exit 1
fi

configuration_directory="${3:-$HOME/.config/authelia}"
mkdir -p "$configuration_directory"
if [ -e "$configuration_directory/users.json" ]; then
  echo "The user file already exists. Inspect it before replacing it." >&2
  exit 1
fi

digest_file=$(mktemp "$configuration_directory/password.XXXXXX")
trap 'rm -f "$digest_file"' EXIT
script --quiet --return --echo never \
  --command 'exec "$HOME/.local/bin/authelia" crypto hash generate argon2' \
  "$digest_file"

python3 - "$digest_file" "$configuration_directory/users.json" "$1" "$2" <<'PY'
import json
import re
import sys
from pathlib import Path

source, destination, username, email = sys.argv[1:]
match = re.search(r"Digest:\s+(\$argon2id\$[^\s]+)", Path(source).read_text())
if match is None:
    raise SystemExit("Authelia did not produce an argon2id password hash.")
user = {"displayname": username, "password": match.group(1), "email": email}
with Path(destination).open("x") as stream:
    json.dump({"users": {username: user}}, stream, indent=2)
print("Saved the hashed password in the protected Authelia user file.")
PY
