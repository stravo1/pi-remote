#!/usr/bin/env bash
# Set up pi remote, Authelia, Caddy, and SearXNG on a fresh Ubuntu or Debian VPS.
# Run it as a normal user with sudo, from a checkout of this repository:
#   bash deploy/easy-install.sh
# It asks for the domain, the login name, and an email. Set DOMAIN, PI_USER, and PI_EMAIL
# to skip the questions. It is safe to run again: each step skips what already exists.
set -euo pipefail

node_version=24.16.0
caddy_version=2.11.7
authelia_version=4.39.28
directory="$(cd "$(dirname "$0")/.." && pwd)"
bin="$HOME/.local/bin"
export PATH="$bin:$PATH"

declare -A node_sha256=(
  [arm64]=524659219d6a207a7400f2bde15d19ba060ffbe0d32a8643319ad67e3bb64c78
  [x64]=d804845d34eddc21dc1092b519d643ef40b1f58ec5dec5c22b1f4bd8fabde6c9
)
declare -A caddy_sha512=(
  [arm64]=3db36ba90c7a6e8dda40ee3dd71fa08844c76b5fb08f61b31e5e78d2ed38e71c51dc7baed875e50d1ca1279196e84302967237386ae87c91ae9f2aaceada682e
  [amd64]=a7a433a1b133efc3c8d10eb0b99d52a24b5ef5c322dc77f5282182b1c0402139ab83f3a99f0c52409df77d20123fb0b523edad8a66d8f5e49136197bf61ef0e7
)
declare -A authelia_sha256=(
  [arm64]=089f3f8bdcba962024e15283811256cea28032d1cdccc56cf4e4c1b284022faa
  [amd64]=e8ad9ff965cbf3b93138945e13cb4b7874c999c254772b2bb77952863177699c
)

step() { printf '\n==> %s\n' "$1"; }
fail() { echo "Error: $1" >&2; exit 1; }

check_host() {
  [ "$(id -u)" -ne 0 ] || fail "Run this as a normal user with sudo, not as root."
  command -v apt-get >/dev/null || fail "This script needs Ubuntu or Debian."
  command -v systemctl >/dev/null || fail "This script needs systemd."
  case "$(uname -m)" in
    aarch64 | arm64) node_arch=arm64 release_arch=arm64 ;;
    x86_64) node_arch=x64 release_arch=amd64 ;;
    *) fail "Unsupported CPU: $(uname -m). Use arm64 or x86_64." ;;
  esac
  sudo -v
}

ask_settings() {
  [ -n "${DOMAIN:-}" ] || read -rp "Domain (the app opens at pi.<domain>): " DOMAIN
  [ -n "${PI_USER:-}" ] || read -rp "Login name: " PI_USER
  [ -n "${PI_EMAIL:-}" ] || read -rp "Email for the login (no mail is sent): " PI_EMAIL
  [[ "$DOMAIN" =~ ^[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]] || fail "The domain must look like example.com."
  [[ "$PI_USER" =~ ^[A-Za-z0-9._-]+$ ]] || fail "Use letters, numbers, dots, dashes, or underscores for the login name."
}

install_packages() {
  step "Installing system packages"
  sudo apt-get update -qq
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
    ca-certificates curl git jq openssl xz-utils util-linux libcap2-bin build-essential \
    python3 python3-venv python3-dev libxslt1-dev zlib1g-dev libffi-dev libssl-dev >/dev/null
}

add_swap() {
  local memory_kb
  memory_kb=$(awk '/MemTotal/ {print $2}' /proc/meminfo)
  if [ "$memory_kb" -lt 3000000 ] && [ -z "$(swapon --show --noheadings)" ]; then
    step "Adding a 1 GB swap file for this small machine"
    sudo fallocate -l 1G /swapfile
    sudo chmod 600 /swapfile
    sudo mkswap /swapfile >/dev/null
    sudo swapon /swapfile
    echo "/swapfile none swap sw 0 0" | sudo tee -a /etc/fstab >/dev/null
  fi
}

# Download a file and stop if its checksum does not match the pinned value.
download() {
  local url="$1" algorithm="$2" checksum="$3" file="$4"
  curl -fsSL --retry 3 -o "$file" "$url"
  echo "$checksum  $file" | "${algorithm}sum" --check --quiet || fail "Checksum mismatch for $url"
}

install_node() {
  local target="$HOME/.local/share/node/v$node_version"
  if [ ! -x "$target/bin/node" ]; then
    step "Installing Node $node_version"
    local archive
    archive=$(mktemp)
    download "https://nodejs.org/dist/v$node_version/node-v$node_version-linux-$node_arch.tar.xz" \
      sha256 "${node_sha256[$node_arch]}" "$archive"
    mkdir -p "$target"
    tar -xJf "$archive" -C "$target" --strip-components 1
    rm -f "$archive"
  fi
  mkdir -p "$bin"
  for tool in node npm npx; do ln -sf "$target/bin/$tool" "$bin/$tool"; done
}

# Install one release binary from a .tar.gz into ~/.local/share and link it in ~/.local/bin.
install_binary() {
  local name="$1" version="$2" url="$3" algorithm="$4" checksum="$5"
  local target="$HOME/.local/share/$name/v$version"
  if [ ! -x "$target/$name" ]; then
    step "Installing $name $version"
    local archive
    archive=$(mktemp)
    download "$url" "$algorithm" "$checksum" "$archive"
    mkdir -p "$target"
    tar -xzf "$archive" -C "$target" "$name"
    rm -f "$archive"
  fi
  mkdir -p "$bin"
  ln -sf "$target/$name" "$bin/$name"
}

install_proxy_and_login() {
  install_binary caddy "$caddy_version" \
    "https://github.com/caddyserver/caddy/releases/download/v$caddy_version/caddy_${caddy_version}_linux_$release_arch.tar.gz" \
    sha512 "${caddy_sha512[$release_arch]}"
  sudo setcap cap_net_bind_service=+ep "$(readlink -f "$bin/caddy")"
  install_binary authelia "$authelia_version" \
    "https://github.com/authelia/authelia/releases/download/v$authelia_version/authelia-v$authelia_version-linux-$release_arch.tar.gz" \
    sha256 "${authelia_sha256[$release_arch]}"
}

build_app() {
  step "Building pi remote"
  (cd "$directory" && npm ci --no-audit --no-fund && npm run build)
}

write_app_config() {
  local config="$directory/config.local.json"
  [ -f "$config" ] && return
  step "Writing config.local.json"
  mkdir -p "$HOME/projects"
  jq -n --arg origin "https://pi.$DOMAIN" --arg user "$PI_USER" --arg root "$HOME/projects" \
    --arg push "$HOME/.config/pi-remote/push.json" \
    '{host: "127.0.0.1", port: 7710, origin: $origin, allowedUser: $user, projectsRoot: $root, idleMinutes: 30,
      push: {contact: $origin, file: $push}}' \
    > "$config"
}

write_authelia_config() {
  local configuration="$HOME/.config/authelia" state="$HOME/.local/state/authelia"
  [ -f "$configuration/configuration.yml" ] && return
  step "Writing the Authelia configuration"
  mkdir -p "$configuration" "$state"
  chmod 700 "$configuration" "$state"
  (umask 077 && sed -e "s|__DOMAIN__|$DOMAIN|g" \
    -e "s|__CONFIGURATION_DIRECTORY__|$configuration|g" -e "s|__STATE_DIRECTORY__|$state|g" \
    -e "s|__RESET_PASSWORD_SECRET__|$(openssl rand -hex 32)|" -e "s|__SESSION_SECRET__|$(openssl rand -hex 32)|" \
    -e "s|__STORAGE_KEY__|$(openssl rand -hex 32)|" \
    "$directory/deploy/authelia.configuration.yml" > "$configuration/configuration.yml")
}

write_caddy_config() {
  local caddyfile="$HOME/.config/pi-remote/Caddyfile"
  [ -f "$caddyfile" ] && return
  mkdir -p "$(dirname "$caddyfile")"
  sed "s|__DOMAIN__|$DOMAIN|g" "$directory/deploy/Caddyfile" > "$caddyfile"
}

set_password() {
  [ -f "$HOME/.config/authelia/users.json" ] && return
  step "Choose the password for $PI_USER"
  bash "$directory/deploy/set-authelia-password.sh" "$PI_USER" "$PI_EMAIL"
}

open_firewall() {
  if sudo ufw status 2>/dev/null | grep -q "Status: active"; then
    sudo ufw allow 80/tcp >/dev/null
    sudo ufw allow 443/tcp >/dev/null
  fi
}

print_next_steps() {
  cat <<EOF

pi remote is installed.

1. Point DNS A records for pi.$DOMAIN and auth.$DOMAIN to this server.
   Caddy gets HTTPS certificates as soon as both names resolve here.
2. Allow ports 80 and 443 in your cloud provider's firewall.
3. Open https://pi.$DOMAIN and sign in as $PI_USER.
   To register a second factor, read the link Authelia writes to
   ~/.local/state/authelia/notifications.txt.
4. In pi remote, open Settings and add an AI provider.

Check the services:  bash deploy/check-services.sh pi.$DOMAIN
Update SearXNG:      ~/searxng/update.sh
EOF
}

main() {
  check_host
  ask_settings
  install_packages
  add_swap
  install_node
  install_proxy_and_login
  build_app
  write_app_config
  write_authelia_config
  write_caddy_config
  set_password
  open_firewall
  step "Starting Authelia, pi remote, and Caddy"
  bash "$directory/deploy/install-service.sh"
  step "Setting up SearXNG web search"
  bash "$directory/deploy/searxng/install.sh"
  print_next_steps
}

main "$@"
