#!/usr/bin/env bash
# Update SearXNG to the latest commit and restart it.
# Usage: ~/searxng/update.sh
set -euo pipefail

git -C ~/searxng/src fetch -q origin
git -C ~/searxng/src checkout -q origin/HEAD
~/searxng/venv/bin/pip install -q -U pip setuptools wheel pyyaml msgspec typing_extensions granian
(cd ~/searxng/src && ~/searxng/venv/bin/pip install -q --use-pep517 --no-build-isolation -e .)
systemctl --user restart searxng
git -C ~/searxng/src log -1 --format="SearXNG %h %cs"
