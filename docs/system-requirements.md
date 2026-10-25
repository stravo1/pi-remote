# System requirements

The target host is a small, rented AWS EC2 instance running Linux. Everything on it is self-hosted: Caddy for HTTPS, Authelia for the login, the server, and pi.

## Software on the host

| Software | Requirement | Notes |
|---|---|---|
| Operating system | Ubuntu 24.04 LTS or Amazon Linux 2023 | pi also runs on macOS and Windows. This project tests Linux only. |
| Node.js | 22.19.0 or later | pi 1.4.0 declares `"node": ">=22.19.0"`. Distribution packages can be older. Install from nodejs.org, NodeSource, or nvm, then check `node -v`. |
| pi | `@earendil-works/pi-coding-agent`, exact version pinned in `server/package.json` | The server loads pi as a library. A global `pi` CLI is optional, but it helps for setup and login. |
| Model provider credentials | An API key for a cloud provider that pi supports | A small instance cannot run a local model. On a headless host, an API key in an environment variable is the simplest option. |
| Caddy | Current 2.x release | Serves HTTPS, gets and renews Let's Encrypt certificates, and sends each request to Authelia with `forward_auth`. |
| Authelia | Current 4.x release | One binary or one container. Uses a YAML user file, a SQLite database, and the filesystem notifier. It needs no Redis, SQL server, or mail server for one user. |
| systemd | Included in the OS | Runs Caddy, Authelia, and the server. Starts them at boot and restarts them after a crash. |
| Automatic updates | `unattended-upgrades` (Ubuntu) or `dnf-automatic` (Amazon Linux) | Installs OS security updates. |
| Git | Any current version | pi and your projects use it. |
| Project toolchains | The compilers, runtimes, and package managers your projects need | pi runs them as your user. The server does not install them. Also install `build-essential` (Ubuntu) or `gcc-c++ make` (Amazon Linux) for npm packages with native code. |

pi has native code only in its terminal package. It ships prebuilt binaries for `linux-x64` and `linux-arm64`. ARM instances (Graviton) and Intel instances both work.

## Domain and DNS

| Item | Requirement |
|---|---|
| Domain | A domain you control at any registrar |
| `pi.<domain>` | `A` record to the Elastic IP. Serves the app. |
| `auth.<domain>` | `A` record to the Elastic IP. Serves the Authelia login page. |

Both names must share the parent domain, because Authelia sets its session cookie on it.

## EC2 instance

### Memory

These numbers come from pi 1.4.0 on macOS arm64. Expect similar numbers on Linux.

| State | Resident memory |
|---|---|
| Node.js alone | 44 MB |
| Node.js with the pi SDK loaded | 132 MB |
| One idle session | 163 MB |
| Two idle sessions | 168 MB |

Caddy and Authelia add tens of MB each. This is an estimate, not a measurement. The tools that pi runs use most of the memory: `npm install`, test runners, builders, and language servers.

| Instance | vCPU | Memory | Fit |
|---|---|---|---|
| `t4g.nano` | 2 | 0.5 GB | Too small |
| `t4g.micro` | 2 | 1 GB | Chat, file edits, and light shell commands. Add a 2 GB swap file. |
| `t4g.small` | 2 | 2 GB | Recommended. Room for `npm install` and test runs in small projects. |
| `t4g.medium` | 2 | 4 GB | For projects with heavy builds |

`t4g` is ARM (Graviton). Choose `t3` for the same sizes on Intel.

### CPU credits

`t3` and `t4g` instances are burstable. They start in unlimited mode by default. Long builds at high CPU can add charges beyond the hourly price. Watch the CPU credit balance in CloudWatch, or switch the instance to standard mode to cap the cost.

### Storage

| Item | Requirement |
|---|---|
| Root volume | gp3, 20 GB or more. The default 8 GB fills with `node_modules`, Git checkouts, and logs. |
| Swap | A 2 GB swap file on instances with 1 GB of memory or less |
| Backups | Scheduled EBS snapshots. The volume holds pi sessions (`~/.pi/agent/sessions/`) and Authelia's SQLite database. |

### Network

| Item | Requirement |
|---|---|
| Public address | An Elastic IP attached to the instance. A normal public IP changes after a stop and start. An attached Elastic IP costs the same as any public IPv4 ($0.005 per hour). AWS also charges for an Elastic IP that is not attached. |
| Inbound port 443 | Open to all. HTTPS. |
| Inbound port 80 | Open to all. Caddy uses it for certificate challenges and the redirect to HTTPS. |
| Inbound port 22 | Open to your IP address only, or closed. With port 22 closed, use AWS Systems Manager Session Manager for a shell. |
| Server port | Listens on `127.0.0.1` only. Not in the security group. |

Open ports 80 and 443 only after Authelia works. Before that, reach the server through an SSH port forward.

### Build the client elsewhere

A Vite build of `web/` can run out of memory on a 1 GB instance. Build `web/dist` on a development machine or in CI, and copy it to the host. The server only serves the built files.

## Client devices

| Item | Requirement | Notes |
|---|---|---|
| Browser | A current version of Safari, Chrome, Firefox, or Edge | The client needs WebSocket and ES2022 support. No other app is needed. |
| Second factor | A TOTP app (for example an authenticator app) or a passkey | Authelia asks for it at login. |
| Push notifications (Phase 5) | The client installed as a PWA | On iOS and iPadOS, add the app to the home screen first. Safari supports web push only for home screen apps. |

## Accounts

| Account | Notes |
|---|---|
| AWS | Instance hours, EBS storage, the public IPv4 address, and burst CPU charges in unlimited mode |
| Domain registrar | Yearly domain fee |
| Model provider | Any cloud provider pi supports. Usage costs come from the provider. |

Let's Encrypt needs no account setup. Caddy registers with it on first start.

## Development machine

| Software | Requirement |
|---|---|
| Node.js | 22.19.0 or later |
| Package manager | npm, with workspaces for `server/` and `web/` |
| Editor | Any editor with TypeScript and Vue support |

An Apple silicon Mac can also run the full stack for local testing. As a public host, a home machine needs router port forwarding and dynamic DNS, so this project does not plan for it.
