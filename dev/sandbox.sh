#!/usr/bin/env bash
#
# Start a development instance of pi remote that is isolated from a live install.
#
# Use this on the machine that already serves pi remote. The live instance keeps its
# port, its project list, and its pi state. This script uses its own ports, its own
# projects root, and its own pi agent directory, so a session started here cannot
# change the sessions or the provider logins of the live instance.
#
# The only state copied from the live install is the provider login file, so the dev
# instance can reach your models without a new sign-in. The copy happens once. Later
# sign-ins in the dev instance stay in the sandbox.
#
# Usage:
#   bash dev/sandbox.sh [--projects DIR] [--lan]
#
# Options:
#   --projects DIR  Folder that holds the projects of the dev instance.
#                   Default: <sandbox>/projects. The script refuses a folder that a
#                   running instance already uses. Both instances would write the
#                   same projects.json file, and a delete in one instance would
#                   remove a folder of the other.
#   --lan           Listen on all interfaces instead of loopback. Anyone on the
#                   network can use the dev instance without a login.
#   --help          Show this text.
#
# Environment:
#   PI_REMOTE_DEV_DIR  Sandbox directory. Default: ~/.local/state/pi-remote-dev
#
set -euo pipefail

script_directory=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
repository=$(cd -- "$script_directory/.." && pwd)
sandbox=${PI_REMOTE_DEV_DIR:-${XDG_STATE_HOME:-$HOME/.local/state}/pi-remote-dev}
projects=$sandbox/projects
lan=false

usage() {
  awk '/^set -euo pipefail$/ { exit } NR >= 3 { sub(/^# ?/, ""); print }' "${BASH_SOURCE[0]}"
}

fail() {
  printf 'sandbox: %s\n' "$1" >&2
  exit 1
}

while [ $# -gt 0 ]; do
  case $1 in
    --projects)
      [ $# -ge 2 ] || fail "--projects needs a directory"
      projects=$2
      shift 2
      ;;
    --lan)
      lan=true
      shift
      ;;
    --help | -h)
      usage
      exit 0
      ;;
    *) fail "unknown option: $1" ;;
  esac
done

command -v node >/dev/null || fail "node is not on PATH. Install Node 22.19 or later and try again."
command -v npm >/dev/null || fail "npm is not on PATH. Install Node 22.19 or later and try again."
[ -d "$repository/node_modules" ] || fail "Dependencies are missing. Run npm install in $repository first."
[ -f "$repository/config.example.json" ] || fail "$repository is not a pi remote checkout."

projects=$(realpath -m -- "$projects")
sandbox=$(realpath -m -- "$sandbox")
[ "$projects" != "/" ] || fail "--projects cannot be the root directory"

# Refuses a projects root that a running server already owns. Two instances on one root
# share projects.json, and either one can delete a folder of the other.
shared_root=$(
  node --input-type=module -e '
    import { readdirSync, readFileSync, realpathSync } from "node:fs";
    const target = process.argv[1];
    for (const entry of readdirSync("/proc")) {
      if (!/^\d+$/.test(entry) || Number(entry) === process.pid) continue;
      let args;
      try {
        args = readFileSync(`/proc/${entry}/cmdline`, "utf8").split("\0");
      } catch {
        continue;
      }
      for (const argument of args) {
        if (!argument.endsWith(".json")) continue;
        let root;
        try {
          root = JSON.parse(readFileSync(argument, "utf8")).projectsRoot;
        } catch {
          continue;
        }
        if (typeof root !== "string") continue;
        try {
          if (realpathSync(root) === target) {
            console.log(`${root} (process ${entry})`);
            process.exit(0);
          }
        } catch {}
      }
    }
  ' "$projects"
)
[ -z "$shared_root" ] ||
  fail "$shared_root is the projects root of a running pi remote instance. Pick another --projects folder."

# Returns the first free port at or above the start port on the loopback interface.
find_free_port() {
  local port=$1
  while :; do
    if node --input-type=module -e '
      import net from "node:net";
      const server = net.createServer();
      server.once("error", () => process.exit(1));
      server.listen(Number(process.argv[1]), "127.0.0.1", () => server.close(() => process.exit(0)));
    ' "$port" >/dev/null 2>&1; then
      printf '%s\n' "$port"
      return
    fi
    port=$((port + 1))
    [ "$port" -le 65535 ] || fail "no free port found"
  done
}

backend_port=$(find_free_port 7711)
frontend_port=$(find_free_port 8080)
while [ "$frontend_port" = "$backend_port" ]; do
  frontend_port=$(find_free_port $((frontend_port + 1)))
done

config=$sandbox/config.json
agent_directory=$sandbox/pi-agent

mkdir -p "$sandbox" "$projects" "$agent_directory"
chmod 700 "$sandbox" "$agent_directory"

# Provider logins are copied once. A sign-in in the dev instance never reaches the live one.
for file in auth.json settings.json models-store.json; do
  if [ -f "$HOME/.pi/agent/$file" ] && [ ! -e "$agent_directory/$file" ]; then
    cp -p "$HOME/.pi/agent/$file" "$agent_directory/$file"
    chmod 600 "$agent_directory/$file"
  fi
done

cat >"$config" <<JSON
{
  "host": "127.0.0.1",
  "port": $backend_port,
  "origin": "http://127.0.0.1:$frontend_port",
  "allowedUser": "$(id -un | sed 's/[^A-Za-z0-9._-]/_/g')",
  "projectsRoot": "$projects",
  "idleMinutes": 30
}
JSON

backend_pid=
frontend_pid=

# Each child runs in its own session, so stopping the script stops every node process below it.
stop() {
  trap - EXIT INT TERM
  [ -n "$backend_pid" ] && kill -TERM -- "-$backend_pid" 2>/dev/null || true
  [ -n "$frontend_pid" ] && kill -TERM -- "-$frontend_pid" 2>/dev/null || true
  wait 2>/dev/null || true
}
trap stop EXIT INT TERM

cd "$repository"
export PI_CODING_AGENT_DIR=$agent_directory

setsid npm run dev -w server -- "$config" &
backend_pid=$!
web_arguments=()
[ "$lan" = true ] && web_arguments+=(--lan)
setsid npm run dev -w web -- "$config" "${web_arguments[@]}" &
frontend_pid=$!

# Waits until the proxy answers, so the printed URL works right away.
wait_for() {
  local url=$1 attempt=0
  until node --input-type=module -e '
    process.exit((await fetch(process.argv[1], { signal: AbortSignal.timeout(1000) })).ok ? 0 : 1);
  ' "$url" >/dev/null 2>&1; do
    attempt=$((attempt + 1))
    [ "$attempt" -lt 120 ] || return 1
    kill -0 "$backend_pid" 2>/dev/null || return 1
    kill -0 "$frontend_pid" 2>/dev/null || return 1
    sleep 0.25
  done
}

if ! wait_for "http://127.0.0.1:$frontend_port/api/ping"; then
  fail "the dev instance did not start. Read the output above."
fi

printf '\n'
printf 'pi remote sandbox is running\n'
printf '  app       http://127.0.0.1:%s\n' "$frontend_port"
printf '  backend   http://127.0.0.1:%s\n' "$backend_port"
printf '  config    %s\n' "$config"
printf '  projects  %s\n' "$projects"
printf '  pi state  %s\n' "$agent_directory"
printf '\n'
printf 'This instance shares no port, project, session, or login with the live install.\n'
printf 'To open the app from another machine, forward the port over SSH:\n'
printf '  ssh -L %s:127.0.0.1:%s %s@<this-host>\n' "$frontend_port" "$frontend_port" "$(id -un)"
printf 'Press Ctrl+C to stop.\n'

wait
