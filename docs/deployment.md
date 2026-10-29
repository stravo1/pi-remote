# Deployment

Use the phase handoff for the current host, addresses, versions, and progress.
This file describes the setup. It contains no credentials.

## Quick install

`deploy/easy-install.sh` sets up a fresh Ubuntu or Debian VPS in one run, on arm64 or x86_64.
It installs pi remote, Authelia, Caddy, and SearXNG web search, and starts them as user services.
Run it as a normal user with `sudo`, from a checkout of this repository:

```sh
git clone <this repository> ~/pi-remote
cd ~/pi-remote
bash deploy/easy-install.sh
```

The script asks for the domain, the login name, and an email, then for the password twice.
Set `DOMAIN`, `PI_USER`, and `PI_EMAIL` to skip the first three questions.
It is safe to run again. Each step skips what already exists, so it never replaces secrets or the password.

The script does these steps:

1. It installs the system packages and adds 1 GB of swap on machines with less than 3 GB of memory.
2. It installs pinned Node, Caddy, and Authelia releases under `~/.local` and verifies each checksum.
3. It builds the app and writes `config.local.json`, with `~/projects` as `projectsRoot`.
4. It writes the Authelia configuration with new random secrets, and the Caddyfile for `pi.<domain>` and `auth.<domain>`.
5. It runs `deploy/set-authelia-password.sh` for the password and `deploy/install-service.sh` for the services.
6. It runs `deploy/searxng/install.sh`, which installs SearXNG on `127.0.0.1:8888` and the pi `web-search` skill.

After the script, point DNS records for `pi.<domain>` and `auth.<domain>` to the server.
Allow ports 80 and 443 in the cloud firewall. Caddy then gets the certificates.
To update SearXNG later, run `~/searxng/update.sh`.

The sections below describe each part in detail, for a manual setup.

## Host and app

Use Ubuntu 24.04 ARM64 on a `t4g.small`, with a 20 GiB gp3 root volume.
Attach an Elastic IP and point `pi.<domain>` and `auth.<domain>` to it.
Install Node 22.19 or later, Git, and `build-essential`.

Build `web/dist` on the development machine. Copy the repo and the built files to the host.
Install only server production dependencies:

```sh
npm ci --omit=dev --workspace server
```

Keep model credentials in `~/.pi/agent/auth.json` with permissions `600`.
Keep the app configuration in the ignored `config.local.json`. Set its required `projectsRoot` to the absolute directory that holds all pi remote projects. Remove any legacy `projects` array; the server rejects it.
Bind the app to `127.0.0.1:7710`. Its `allowedUser` must match the Authelia username.
Start it with `node server/src/main.ts /absolute/path/to/config.local.json`.
Check that `/api/ping` returns 204 and a WebSocket upgrade without `Remote-User` returns 403.

### Push notifications

Push is optional. To turn it on, add a `push` object to `config.local.json`:

```json
"push": { "contact": "https://pi.example.com", "file": "/home/ubuntu/.config/pi-remote/push.json" }
```

`contact` is a `mailto:` or `https://` address. Push services such as Apple and Google receive it. `file` is an absolute path. On first start, the server creates it with mode `600`. It holds the VAPID key pair and the device subscriptions. Keep it with the backups. A new key pair makes every device turn push on again.

Pushes go straight from the server to each browser's push service. No separate push server is needed.
On iPhone and iPad, push works only in iOS 16.4 or later, and only after you add pi remote to the Home Screen and open it from there.
Then open Settings and turn on Push notifications. A device gets a notice when a run finishes, unless that session is on its screen.

## Authelia

Install a versioned official Authelia ARM64 binary under the host user's home directory.
Verify the archive checksum before running it.
Link the binary at `~/.local/bin/authelia`.

Render [the configuration template](../deploy/authelia.configuration.yml) to `~/.config/authelia/configuration.yml`.
Replace the domain and directory tokens with the host's values.
Generate three separate random secrets of at least 64 characters for the secret tokens.
Use permissions `700` for private directories and `600` for configuration files.
Keep SQLite and notification files in `~/.local/state/authelia`.

In an interactive SSH session, run this from the host checkout:

```sh
bash deploy/set-authelia-password.sh USERNAME NOTIFICATION_EMAIL
```

The helper prompts for the password twice through Authelia.
It saves an argon2id hash in `~/.config/authelia/users.json` and removes its temporary output file.
It uses Linux `script` to keep Authelia's input and output attached to a terminal during capture.
It disables terminal echo and records output only.
It refuses to replace an existing user file.
The filesystem notifier writes identity verification links locally. It does not send email.
Read those links through SSH when the user enrolls TOTP.
Do not publish them or add them to Git.

On a Linux host with Authelia installed, run the interactive regression checks with:

```sh
python3 -m unittest discover -s deploy -p 'test_*.py' -v
```

These checks use disposable configuration directories and test passwords.
They verify hidden input, hash validation, file permissions, overwrite protection, and cleanup after mismatched passwords.

Validate and start Authelia:

```sh
~/.local/bin/authelia config validate --config ~/.config/authelia/configuration.yml
~/.local/bin/authelia --config ~/.config/authelia/configuration.yml
```

Check its health endpoint on `127.0.0.1:9091` before opening public ports.
See the official [file backend](https://www.authelia.com/configuration/first-factor/file/) and [password guide](https://www.authelia.com/reference/guides/passwords/).

## SearXNG

`deploy/searxng/settings.yml` renders to `~/.config/searxng/settings.yml` with a fresh secret key.
The file turns the limiter off, since only the host can reach the server, and serves both HTML and JSON.
It raises `outgoing.request_timeout` to 6 s, so one slow engine does not fail a whole search.
It enables the engines that ship disabled and weights `brave` and `google cse` at 2.0.
`install.sh` writes the settings only when the file is missing, so it never overwrites a host's own edits.
An existing host that wants these tweaks copies the file by hand, sets `secret_key`, and restarts `searxng`.

## Caddy

Use normal Caddy certificate challenges. Open ports 80 and 443 after Authelia passes its local health check.
For a binary install, keep Caddy under the host user's home directory and verify the archive checksum.
Use `sudo setcap cap_net_bind_service=+ep /absolute/path/to/caddy` to permit web-port binding without running as root.
Render [the Caddyfile](../deploy/Caddyfile) with the domain. Validate it before starting Caddy.
The app route removes the client's `Remote-User`, then copies that header only after Authelia accepts the request.
The auth route proxies to Authelia. Both upstreams listen only on loopback.
See the official [Authelia integration](https://www.authelia.com/integration/proxies/caddy/).
Proxy tests must use HTTPS. Authelia rejects authorization requests for plain HTTP target URLs.

After login, enroll TOTP and send a prompt from the phone.
Check that unauthenticated requests and requests with a forged `Remote-User` go to the login page.
Phase 4 adds service units, automatic restarts, and backups.

## Continuous deployment

A push to `main` runs `.github/workflows/ci.yml`.
The `test` job runs the type check, the tests, and the build.
The `deploy` job runs only on `main`, after `test` passes.
It sends one tar of `server/src`, `web/dist`, and the package files to the host over SSH.
On the host, `deploy/receive.sh` unpacks the tar, runs `npm ci --omit=dev --workspace server`, and restarts the service.
It then checks `/api/ping` and fails the run if it gets no answer.
The job never touches `config.local.json` or `~/.pi`.

### The deploy key

The deploy key is separate from the EC2 key pair. In the host's `~/.ssh/authorized_keys`, it has this form:

```
restrict,command="/home/ubuntu/pi-remote/deploy/receive.sh" ssh-ed25519 AAAA... pi-remote-ci
```

The key can run only `receive.sh`. It gets no shell and no port forwarding.
`receive.sh` is not part of the tar. Copy it to the host by hand when it changes.
The forced command gets a minimal PATH from sshd, which does not include
`~/.local/bin`. `receive.sh` adds `~/.local/bin` itself, so it finds the npm
that easy-install installs there.

The forced command must point at the checkout the service serves, because
`receive.sh` installs the build in its own checkout. A usual mistake is to
repoint the command at an older or developer checkout. `deploy/install-service.sh`
warns when the deploy key drifted. To install or repair the key on the host, run
from the served checkout:

```sh
bash deploy/deploy-key.sh deploy_key.pub
```

The script replaces any older `receive.sh` force-command line for any checkout.
With `DEPLOY_KEY_PUB=deploy_key.pub` in the environment, `easy-install.sh` runs it
as the last step, so a fresh host gets continuous deployment in one run.

### One-time setup

On the host, with the hand-started server stopped, copy `deploy/` and run:

```sh
bash deploy/install-service.sh
```

The script installs systemd user services for Authelia, the app, and Caddy.
It turns on lingering, enables each service at boot, and starts each service.
Run `bash deploy/check-services.sh pi.<domain>` after installation and each recovery test.
Read logs with `journalctl --user -u authelia -u pi-remote -u caddy -f`.

Make a deploy key on your Mac, then add it to `authorized_keys` with the line above:

```sh
ssh-keygen -t ed25519 -N "" -C pi-remote-ci -f ./deploy_key
ssh-keyscan -t ed25519 pi.example.com
```

Check that the `ssh-keyscan` key matches `/etc/ssh/ssh_host_ed25519_key.pub` on the host.
In the GitHub repository, create an environment named `production`.
Add these secrets to it:

| Secret               | Value                                         |
| -------------------- | --------------------------------------------- |
| `DEPLOY_HOST`        | `pi.example.com`                              |
| `DEPLOY_USER`        | `ubuntu`                                      |
| `DEPLOY_SSH_KEY`     | The contents of `./deploy_key`                |
| `DEPLOY_KNOWN_HOSTS` | The `ssh-keyscan` line, without comment lines |

Delete the local key files after you save the secret.
For approval before each deploy, add a required reviewer to the `production` environment.
