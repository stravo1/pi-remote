# Phase 1: Basic working app

Status: Done
Last updated: 2026-10-26

## Goal

One prompt from a phone, with streamed output, behind a password and a second factor. At the end, the server runs on an AWS EC2 host behind Caddy and Authelia on `pi.<domain>`. One session opens at server start. The client shows the reply as it streams. See [roadmap Phase 1](../roadmap.md#phase-1-basic-working-app). Covers F4, F5 (prompt only), N1, and N6.

## Read first

- `docs/spec.md`: Architecture, Server modules, D4 (event format), D5 (login), D7 (frontend), Wire protocol, Configuration, Security.
- `docs/pi-events.md`: the event order, overlapping content blocks, the `system` message, and the fake model.
- `docs/system-requirements.md`: the EC2 instance, DNS, and network rules.
- `spikes/phase-0/p08-faux.ts`: how to drive a session with `fauxProvider`.

## Scope

In scope: `server/` (`PiAdapter` with `prompt`, the `/ws` endpoint, the `Origin` and `Remote-User` checks, the ping, `/api/ping`, static files), `web/` (one page with a transcript and an input box), the EC2 host, your DNS registrar DNS, Caddy, and Authelia.

Out of scope: session lists, `subscribe`, snapshots, reconnect (Phase 2). Markdown, tool cards, steer, follow-up (Phase 3). systemd units, backups, automatic updates (Phase 4).

## Tasks

Local tasks run on the Mac. Host tasks need the user for the AWS console, your DNS registrar, and TOTP enrollment.

- [x] P1.1 Create the npm workspace: a root `package.json` with workspaces `server` and `web`. `server` pins `@earendil-works/pi-coding-agent` and `@earendil-works/pi-ai` at exactly `1.4.0`, and uses `ws`. `web` uses Vue 3, Vite, and frappe-ui. Done when: `npm install` succeeds at the root and `npm test -w server` runs.
- [x] P1.2 Server configuration: read the JSON file from the spec's Configuration section. The path comes from the command line. Phase 1 opens its one session in `projects[0]`. Done when: a test shows that a missing field stops the server with an error that names the field.
- [x] P1.3 `PiAdapter`: open one session, `prompt(text)`, and `subscribe(listener)`. Done when: a test with `fauxProvider` sends a prompt and gets the events of a scripted tool call in order, ending in `agent_settled`.
- [x] P1.4 `/ws` endpoint: client `prompt`, server `event` (with `seq`) and `error`. A `prompt` during a run gets `error`. Reject the upgrade with 403 when `Origin` is not the configured `origin`, or when `Remote-User` is not `allowedUser`. Done when: tests with two `ws` clients show the stream, the two rejections, and the error during a run.
- [x] P1.5 Ping (N6): ping each socket every 30 seconds, and close a socket that missed the last pong. The interval is a constructor argument, so tests can use a short one. Done when: a test shows that a client that stops answering gets closed.
- [x] P1.6 HTTP: `GET /api/ping` returns 204, and the server serves `web/dist`. The server listens on `host` from the configuration (`127.0.0.1`). Done when: a test gets 204 from `/api/ping`.
- [x] P1.7 Client: one page with a transcript and an input box, built with frappe-ui components. Skip `system` messages. Place each delta by `contentIndex`. Done when: a unit test feeds `spikes/phase-0/out/tool-call.jsonl` events to the transcript code and gets the final text of both assistant messages.
- [x] P1.8 Log the bytes sent per run, for spec open question 5. Done when: the server prints one line per run with the event count and the bytes.
- [x] P1.9 Local end to end: run Caddy on the Mac in front of the server, with a fixed `Remote-User` header and no Authelia. Done when: a prompt from a browser on the Mac streams a reply from the OpenRouter model.
- [x] P1.10 Host (user): launch a `t4g.small` with Ubuntu 24.04 and a 20 GB gp3 root volume. Enable a public IPv4. An Elastic IP is optional. Use key-only SSH for the user's changing mobile IP. Install Node 22.19 or later, Git, and `build-essential`. Done when: `ssh` works and `node -v` prints 22.19 or later.
- [x] P1.11 Host: copy the repo and a locally built `web/dist` to the host, add the model credentials, and start the server by hand. Done when: an HTTP request on the host gets 204 from `/api/ping`, and a WebSocket upgrade without `Remote-User` gets 403.
- [x] P1.12 DNS (user): in your DNS registrar, add `A` records for `pi.<domain>` and `auth.<domain>` to the host's public IPv4. Done when: `dig +short pi.<domain>` and `dig +short auth.<domain>` print that address.
- [x] P1.13 Authelia: one binary under your user, with a JSON user file (argon2id hash), TOTP, regulation (lockout), SQLite, and the filesystem notifier. It listens on `127.0.0.1:9091`. Done when: its health endpoint answers on the host.
- [x] P1.14 Caddy: `auth.<domain>` goes to Authelia. `pi.<domain>` deletes the client's `Remote-User`, runs `forward_auth` to Authelia, copies `Remote-User` from the answer, and proxies to the server. Normal Caddy certificate challenges are in use. Done when: both names serve valid certificates.
- [x] P1.15 Exit check: log in from the phone with a password and TOTP, send a prompt, and see the reply stream. Done when: that works, a request without a login gets the Authelia page, and a request with a forged `Remote-User` header gets the Authelia page too.

## Known facts

- Phase 0 facts that matter here are in `docs/pi-events.md`. The most important: `prompt()` resolves after an abort, content blocks overlap, and every run starts with a `system` message.
- Node 22.18 and later run `.ts` files without a flag. The server can run with `node` and no build step. Type stripping does not support `enum` or constructor parameter properties.
- `ModelRuntime.create()` writes `{}` to `authPath` when the file is missing. Give tests their own `authPath`.
- A browser cannot set headers on a WebSocket upgrade. Local tests in a browser need a proxy that adds `Remote-User`, which is why P1.9 uses Caddy.
- The user's domain at your DNS registrar is `example.com`. The app will use `pi.example.com`, and Authelia will use `auth.example.com`.

## Decisions

| Decision                                              | Reason                                                                                                                                       | Spec changed?                                           |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Local tasks first, host tasks after.                  | The fake model lets the server get tested without a host. The protocol works before any port opens.                                          | No                                                      |
| One Phase 1, not split.                               | The roadmap puts the host in Phase 1. The user did not ask for a split.                                                                      | No                                                      |
| Rename the app and GitHub repository to pi-remote.    | The user noted another project with the old name and approved pi-remote.                                                                     | No                                                      |
| Add optional `model: { provider, id }` configuration. | Local checks must select OpenRouter without changing the user's pi settings. Without it, pi uses its settings.                               | Yes                                                     |
| Allow Phase 1 prompts to omit `sessionId`.            | There is one session, and the client has no snapshot or session list yet. Events still carry the ID.                                         | Yes                                                     |
| Use isolated headless Playwright for browser checks.  | The user does not want agents to use their personal browser or profiles. This preference is also in global Codex instructions.               | No                                                      |
| Make Elastic IP optional.                             | The user asked about skipping it. Auto-assigned IPv4 works if both DNS records change after a stop/start.                                    | Yes: spec, roadmap, system requirements.                |
| Use an Elastic IP for this deployment.                | After the pricing discussion, the user accepted a stable address for the host.                                                               | No. The app still supports either address type.         |
| Use key-only SSH for the user's changing mobile IP.   | The user chose public SSH after discussing the extra exposure. Password and keyboard-interactive login are disabled on the host.             | Deployment exception to N7's source-IP restriction.     |
| Use the existing OpenRouter key on the host.          | The user selected it. Only that provider entry was copied to the host's protected pi auth file.                                              | No                                                      |
| Use normal Caddy HTTPS.                               | The user chose it. Open ports 80 and 443 after Authelia passes its local health check. The app requires forward_auth from the first request. | Yes: roadmap and system requirements clarify the order. |
| Use JSON for the Authelia user file.                  | Authelia supports it. The helper writes the hash without shell or YAML quoting problems.                                                     | Phase task updated.                                     |

| All app and auth UI must follow Espresso through frappe-ui. | The user explicitly required Espresso-native UI. Using frappe-ui controls inside a separate custom theme was insufficient. | Yes: D7 and AGENTS.md. |
| Use two local dev terminals with the same config-path argument. | The user wanted a clear UI dev flow and consistent CLI syntax. Vite's native positional argument is a directory, so `web/dev.ts` wraps its API. | README updated. |

## Progress

P1.1 to P1.15 are done. The user explicitly confirmed that authenticated chat works from their phone.
The user completed password setup and TOTP enrollment, then showed authenticated chat with two assistant replies.
The later phone confirmation completes the original Phase 1 exit check.
The user confirmed that the new local development flow works.

### Live deployment

| Item          | Current state                                                                     |
| ------------- | --------------------------------------------------------------------------------- |
| App           | `https://pi.example.com`                                                             |
| Login         | `https://auth.example.com`                                                           |
| Host          | `pi-remote`, instance `i-00000000000000000`, `t4g.small`, Mumbai `ap-south-1`     |
| Address       | Elastic IP `203.0.113.10`                                                        |
| OS and disk   | Ubuntu 24.04.5 LTS, ARM64, 20 GiB root disk. Storage encryption was not verified. |
| Host packages | Node `24.16.0`, npm `11.13.0`, Git `2.43.0`, build-essential, GCC `13.3.0`        |
| Checkout      | `/home/ubuntu/pi-remote`, branch `main`, committed revision `1589356`             |
| Model         | `openrouter` / `deepseek/deepseek-v4-flash`                                       |
| Backend       | `127.0.0.1:7710`, PID last observed as `8817`                                     |
| Authelia      | `4.39.28`, `127.0.0.1:9091`, PID last observed as `10196`                         |
| Caddy         | `2.11.7`, public TCP 80 and 443, PID last observed as `10545`                     |
| Login account | `you`, password plus a registered TOTP device named `pi-remote`              |
| Network       | Public TCP 22, 80, and 443. Backend and Authelia listen only on loopback.         |

All three processes run by hand. There are no service units or automatic crash/reboot recovery yet.
Check the PID files and current process commands before relying on these recorded PIDs or starting another copy.
Service management, backups, and update automation remain Phase 4 work.

Caddy deletes the incoming Remote-User header and copies the authenticated value from Authelia.
Both public domains have trusted certificates. Both ordinary unauthenticated requests and forged-header requests return 302 to the login portal.
The auth portal returns 200. A headless browser reached its login form without page errors.
The backend's local ping returned 204, its static frontend returned 200, and a WebSocket upgrade without Remote-User returned 403.
A host smoke prompt streamed two text updates and returned "pi remote server is ready."

### Local code and development

The app includes configuration validation, PiAdapter, a single session, authenticated WebSocket commands, sequence numbers, heartbeat, static serving, and per-run byte logs.
The transcript skips system messages and places overlapping text and thinking deltas by content index.
Session selection, history on reload, snapshots, and reconnect remain Phase 2 work.

The local app screen now uses frappe-ui PageHeader, PageHeaderMobile, Avatar, Badge, Alert, Button, and Textarea.
It uses Espresso semantic tokens for color, typography, spacing, and radii. The old cream theme and custom component styling were removed.
These UI changes are local only. EC2 still serves the previous frontend build.
Authelia still serves its stock UI, which does not satisfy the new Espresso requirement.

Run development in two terminals from the repo root:

```sh
npm run dev -w server -- "$PWD/config.local.json"
npm run dev -w web -- "$PWD/config.local.json"
```

Open `http://127.0.0.1:8080`. The user confirmed this works.
The ignored `config.local.json` was created with this checkout as `projects[0]` and the existing OpenRouter model.
The backend uses Node watch mode. `web/dev.ts` reads the same JSON and starts Vite for Vue hot reload.
Vite proxies `/api` and `/ws`, adds the configured local user header, and preserves the browser's Origin for backend checks.
The dev server binds only to loopback. No Caddy or Authelia is needed locally.
Restart both commands after editing the configuration. Vue and style edits use hot reload.

### Validation

| Check            | Last result                                                                                                                                  |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Server tests     | 28 passed in the final full workspace run.                                                                                                   |
| Web tests        | 3 passed, including a real Vite HTTP/WebSocket proxy test and another-origin rejection.                                                      |
| Type checks      | `npm run check` passed after the current changes.                                                                                            |
| Production build | `npm run build` passed.                                                                                                                      |
| Espresso layout  | Empty and populated views passed isolated headless checks at desktop and 375 px. No page errors or horizontal overflow.                      |
| Password helper  | 2 real-terminal regression tests passed on EC2. They cover hidden input, valid hashes, mode 600, overwrite protection, and mismatch cleanup. |
| Diff hygiene     | `git diff --check` passed.                                                                                                                   |

The final `npm test` workspace run passed all 31 tests: 28 server tests and 3 web tests.

### Configuration and credentials

Node lives under `/opt/node-v24.16.0-linux-arm64`, with executable symlinks in `/usr/local/bin`.
Authelia and Caddy live under `~/.local/share/<service>/<version>/`, with symlinks in `~/.local/bin`.
Official archives were verified against SHA-256 checksums. Caddy has `cap_net_bind_service=+ep` to bind web ports as `ubuntu`.

| File on host                                | Purpose                                                                              |
| ------------------------------------------- | ------------------------------------------------------------------------------------ |
| `~/pi-remote/config.local.json`             | Ignored app config: public origin, user `you`, project `/home/ubuntu/pi-remote` |
| `~/.pi/agent/auth.json`                     | Only the selected OpenRouter credential, mode 600                                    |
| `~/.config/authelia/configuration.yml`      | Rendered config and three separate generated secrets, mode 600                       |
| `~/.config/authelia/users.json`             | One argon2id user entry, mode 600                                                    |
| `~/.local/state/authelia/authelia.sqlite3`  | Persistent Authelia state, including enrolled credentials                            |
| `~/.local/state/authelia/notifications.txt` | Local identity verification messages. No email is sent.                              |
| `~/.config/pi-remote/Caddyfile`             | Rendered authenticated reverse proxy config                                          |

Logs and PID files are under `~/.local/state/pi-remote`, `~/.local/state/authelia`, and `~/.local/state/caddy`.
The local PEM is `/Users/you/.ssh/example-key.pem`, mode 400. It was not copied to EC2.
The user has changing mobile IPs and accepted public key-only SSH. Password and keyboard-interactive SSH authentication are disabled.
The host has no IAM role for Session Manager. Do not insist on it or a fixed source IP as an unapproved scope change.

The password helper originally failed because `tee` made Authelia's stdout a pipe.
Authelia reads its terminal size from stdout. The fix uses Linux `script` with output-only capture and echo disabled.
The helper is in `deploy/set-authelia-password.sh`; its real-terminal tests are in `deploy/test_password_setup.py`.
A third argument selects a disposable configuration directory for tests. The normal user file is never overwritten by the helper.

### Git and deployment state

The app baseline is commit `1589356`, `feat: add basic pi-remote web client`.
The GitHub repo is `github-user/pi-remote`. The local directory is still `/Users/you/Code/pi-web`.
Deployment helpers, deployment docs, dev commands, Espresso UI changes, AGENTS.md changes, and this handoff belong to `feat: add deployment setup and Espresso development workflow`.
The user authorized committing these changes and pushing `main` to origin. Verify the latest hash and tracking state with Git when continuing.
`deploy/` was also copied to EC2 as uncommitted files. The newest local app UI and dev wrapper were not copied to EC2.
`docs/deployment.md` documents the reusable setup. Runtime secrets and generated host configurations remain outside Git.

## Handoff

The original Phase 1 checklist is complete. Both the phone exit check and the local dev flow are confirmed.
Next step: plan the remaining Espresso UI work with the user before starting Phase 2.

Remaining work, in priority order:

1. Review and deploy the locally verified Espresso frontend when the user wants it live. Build locally and copy `web/dist`; a frontend-only update does not need an auth restart.
2. Plan the Espresso-native auth frontend. The user explicitly requires the auth UI to use the same design system.
3. Create the Phase 2 doc from the template before implementing sessions or reconnect. The Phase 1 exit check now passes.

The stock Authelia portal is an interim UI. Themes, logo, favicon, and locale overrides are supported, but they do not make its layout Espresso-native.
Do not claim full UI compliance or start a new hand-built login backend. Keep Authelia responsible for authentication and plan its frontend integration deliberately.
Avoid restarting Authelia during an active login or enrollment flow because its session store is in memory.

For host access:

```sh
ssh -i ~/.ssh/example-key.pem \
  -o IdentitiesOnly=yes \
  -o StrictHostKeyChecking=yes \
  -o UserKnownHostsFile=/private/tmp/pi-remote-known-hosts \
  ubuntu@203.0.113.10
```

The host key file is temporary and may disappear later. If it is missing, verify the host key before establishing a replacement.
The Mac has no AWS CLI/profile or EC2 connector. The user handles AWS console changes.
Do not open or control the user's personal browser or existing profiles. Use isolated headless Playwright for testing.

TOTP enrollment is complete. Normal login uses the user's authenticator, not the notification file.
The filesystem notifier is only for verification/recovery flows. Do not store codes, verification links, password hashes, passwords, or TOTP secrets in Git.
Only extract a current verification code into chat if the user explicitly asks for it.

Useful checks:

```sh
npm test
npm run check
npm run build
```

On EC2, deployment-helper tests use:

```sh
cd /home/ubuntu/pi-remote
python3 -m unittest discover -s deploy -p 'test_*.py' -v
```

Local WebSocket integration tests need permission to bind ephemeral loopback ports in the restricted tool environment.
Do not rerun model prompts or repeat broad checks without a change or an unresolved concern that warrants them.
