# Roadmap

Each phase ends with something you can use. Do not start a phase before the previous one meets its exit check. Requirement IDs (F1, N1) and decision IDs (D1) refer to the [specification](spec.md).

## Phase 0: Spike

Goal: learn how pi behaves through the SDK before you design around it.

1. Install the pinned pi version in a scratch project.
2. Run pi's `examples/sdk/01-minimal.ts`.
3. Log every event of one run that uses a tool. Write down the event types and their order.
4. List sessions with `SessionManager.list(cwd)` and open one with `SessionManager.open(path)`.
5. Call `abort()` during a run. Note the events that follow.
6. Call `steer()` and `followUp()` during a run. Note when each message enters.
7. Find out if pi has a fake model for tests (spec open question 1).

Exit check: a short note in `docs/pi-events.md` lists the event sequence for prompt, tool call, abort, steer, and follow-up.

## Phase 1: Basic working app

Goal: one prompt from a phone, with streamed output. Covers F4, F5 (prompt only), and N1.

- Server: `PiAdapter` with `prompt`, and one WebSocket endpoint. One session, created at server start.
- Client: one page with a transcript area and an input box. Text deltas append to the last assistant message.
- Host: a public IPv4 address, DNS records for `pi.` and `auth.`, Caddy with certificates, and Authelia with a second factor.
- An Elastic IP is optional. With an auto-assigned public IPv4, update both DNS records after a stop/start.
- Server: the `Origin` check and the `Remote-User` check from the spec's Security section, and the 30-second ping (N6).
- Until Authelia passes its local health check, reach the server only through an SSH port forward.
- Then open ports 80 and 443 for Caddy's certificate challenges and HTTPS. Protect the app with forward_auth from the first request.

Exit check: you log in from your phone with a password and a second factor, send a prompt, and see the reply stream in. A request without a login gets the Authelia page.

## Phase 2: Sessions that follow you

Goal: the core feature. Covers F1, F2, F3, F6, F7, F8, F9, F10, and N4.

- `SessionHub`: open sessions, subscribed clients, the run buffer, and `seq`.
- Protocol: `list_sessions`, `new_session`, `subscribe`, `unsubscribe`, `abort`, `snapshot`.
- Session list view, grouped by project.
- Configuration file with the allowed projects.
- Client reconnect with backoff, then a new `subscribe`.
- Idle disposal of sessions.

Exit check: you start a task on a laptop, close the tab, open a phone, and see the same run continue live. A second tab on the same session shows the same events.

## Phase 3: A usable agent UI

Goal: you prefer the client to the terminal for routine tasks. Covers F5 in full and N3.

- Markdown rendering and code highlighting in messages.
- Tool call cards: the command, collapsible output, and status.
- File edits shown as diffs.
- Steer and follow-up during a run.
- Model and thinking level pickers.
- Layout for a 375 px wide screen: sticky input, wrapped diffs.

Exit check: you finish one real task from your phone without opening a terminal.

## Phase 4: Make it reliable

Goal: the server runs without attention. Covers N2.

- Service file: launchd on macOS or systemd on Linux. The server starts at boot and restarts after a crash.
- Automatic OS security updates (`unattended-upgrades` on Ubuntu, `dnf-automatic` on Amazon Linux).
- Backups: scheduled EBS snapshots. The root volume holds pi sessions and Authelia's database.
- UI states for disconnected, reconnecting, login expired, and server errors.
- Structured logs with one line per command and per run.
- Clean shutdown: abort runs, then dispose sessions.

Exit check: reboot the host. The client reconnects, and old sessions open without manual steps.

## Phase 5: Extras

Pick these as needed. Each one is independent.

- Push notifications when a run settles. Done. See the Push notifications section of [deployment](deployment.md).
- Tool approval: a pi extension blocks risky tool calls until a client answers (D6).
- A file browser for the project.
- A terminal tab (xterm.js).
- Image attachments in prompts. Done. Pulled forward in Phase 4.
- MCP: done. Pulled forward in Phase 4. `PiAdapter` loads the `codemode`, `tool_search`, and MCP extensions and calls `bindExtensions`. What may still be wanted: a settings screen for MCP servers and a UI for OAuth sign-in and for extension prompts (`docs/rpc-extension-ui.md`).

### Gaps compared with the pi terminal app

The pi terminal app has these features, and pi remote does not have them yet. The list comes from pi's `docs/slash-commands.md` and `docs/sdk.md`.

| pi feature                                                  | What pi remote needs                                     |
| ----------------------------------------------------------- | -------------------------------------------------------- |
| `/tree`, `/fork`, `/clone`: branch from an earlier message  | A way to fork from a message and to show branches.       |
| `/copy`, `/export` (HTML or JSONL), `/share`                | Copy and export actions on a session.                    |
| `/import <path>`: resume a JSONL session                    | An import action.                                        |
| `/reload`: reload extensions, skills, templates, and themes | A reload action. A server restart works today.           |
| `/scoped-models`                                            | pi remote keeps its own recent models list instead.      |
| MCP servers, `codemode`, and `tool_search`                  | Done in Phase 4. See the MCP item above.                 |
| Image input                                                 | See the image attachments item above.                    |
| Extension prompts that ask the user a question              | A UI for extension prompts (`docs/rpc-extension-ui.md`). |

pi remote runs `/name <title>`, `/compact [instructions]`, and `/session` itself.

These already work, because the SDK loads them: model and thinking choice, provider login, new and saved sessions, skills, prompt templates, context files, and extensions in `~/.pi/agent/extensions`. A prompt that starts with a template or extension command, such as `/foo`, goes to pi. Other built-in pi commands belong to its terminal app and do nothing in pi remote.

Web search: pi has no built-in search tool. The host runs SearXNG as the `searxng` user service on `127.0.0.1:8888`, and the `web-search` skill in `~/.pi/agent/skills` calls it. Run `~/searxng/update.sh` on the host to update SearXNG.

## Risks

| Risk                                                                                                            | Mitigation                                                                                                                                           |
| --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| pi changes its SDK or event shapes. pi went from 0.82 to 1.4 in three months, with breaking changes on the way. | Pin the exact version (N5). Keep all pi calls in `PiAdapter`. Read the changelog before each upgrade.                                                |
| A flaw in Caddy or Authelia lets an attacker past the login. The attacker then has a shell.                     | Second factor on, lockout on, automatic OS updates, and prompt Caddy and Authelia updates. Keep the `Origin` and `Remote-User` checks in the server. |
| A run executes a harmful command while you are away.                                                            | Same risk as pi in a terminal. Add tool approval in Phase 5 if this becomes a concern.                                                               |
| Tool runs use up the memory of a small instance.                                                                | Use `t4g.small` or larger, add swap, and build the client elsewhere. See [system requirements](system-requirements.md).                              |
| Snapshots get too large on long sessions.                                                                       | Measure in Phase 2. Page old messages if needed.                                                                                                     |
