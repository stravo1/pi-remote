# Phase 2: Sessions that follow you

Status: Done
Last updated: 2026-10-26

## Goal

Sessions live on the server and any device can open them. The client lists sessions by project in a sidebar, starts new sessions, opens old ones, and aborts a run. A second tab or a phone sees the same run live. The client reconnects by itself after a network drop. See [roadmap Phase 2](../roadmap.md#phase-2-sessions-that-follow-you). Covers F1, F2, F3, F6, F7, F8, F9, F10, and N4.

## Read first

- `docs/spec.md`: Server modules, D2 (history), Wire protocol, Session lifetime on the server, Failure handling.
- `docs/pi-events.md`: Snapshot check. The snapshot needs the queue from `getSteeringMessages()` and `getFollowUpMessages()`.
- The Phase 1 doc: the live host table and the development flow.

## Scope

In scope: `PiAdapter` list, create, open. `SessionHub`. The commands `list_sessions`, `new_session`, `subscribe`, `unsubscribe`, `prompt`, `abort`. Idle disposal. Client reconnect. A Gameplan-style sidebar: projects are groups, sessions are items.

Out of scope: Markdown, tool cards, steer, follow-up (Phase 3). systemd units and backups (Phase 4). Deploy to the host (needs the user).

## Tasks

- [x] P2.1 `PiAdapter` lists, creates, and opens sessions for a project. `PiSession` wraps one pi session. Done when: a test with `fauxProvider` and a temporary session directory creates a session, lists it, and reopens it with the same messages.
- [x] P2.2 `SessionHub`: open sessions, subscribers, `seq`, the run buffer, and snapshots. Done when: unit tests show fan-out to two clients, a snapshot with the run buffer, and `seq` order.
- [x] P2.3 Idle disposal. Done when: a test shows that a session with no subscriber and no run is disposed after `idleMinutes`, and that a running session is not.
- [x] P2.4 Protocol in `Transport`. `new_session` rejects a project that is not in the configuration. Done when: a test with two `ws` clients shows list, create, subscribe, a shared run, abort, and the F10 rejection.
- [x] P2.5 Client connection: reconnect with backoff, then `subscribe` again. A `seq` gap triggers `subscribe`. Done when: a unit test drives the backoff and the gap rule.
- [x] P2.6 Transcript loads a snapshot. Done when: a unit test builds a transcript from `messages` plus `runEvents` and gets the same result as a full replay.
- [x] P2.7 Sidebar: groups per project, one item per session, a new session button per group, and a drawer on a phone. Done when: headless screenshots at desktop and 375 px show both.
- [x] P2.8 Exit check, local: start a run in one tab, close it, open another tab, and see the run continue. Done when: that works against the OpenRouter model.

## Known facts

- pi writes a session file only after the first assistant message. A new session is not in `SessionManager.list` until then. The hub merges its open sessions into the list.

## Decisions

| Decision                                                                                                              | Reason                                                                                                                                                               | Spec changed?                               |
| --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| `PiAdapter` is the factory. `PiSession` wraps one session.                                                            | The spec gives list, create, and open to `PiAdapter`. Phase 1 used the name for one session.                                                                         | No                                          |
| The server no longer opens a session at start. `prompt` needs `sessionId`.                                            | Sessions are now explicit.                                                                                                                                           | Yes: Configuration                          |
| `sessions` entries carry `isRunning`.                                                                                 | The sidebar shows which sessions work.                                                                                                                               | Yes: Wire protocol                          |
| The client refreshes the list on connect, on `session_created`, on `agent_settled`, and when the tab becomes visible. | The server does not push list changes. This is the least code.                                                                                                       | No                                          |
| Add groups: the client creates a folder inside the optional `projectsRoot`.                                           | The user wants to start work in a new folder from the UI. One root and a checked name keep F10 bounded. The list lives in `<projectsRoot>/.pi-remote/projects.json`. | Yes: F10, F11, Wire protocol, Configuration |
| Add CI and deploy with GitHub Actions and a systemd user service for the app.                                         | The user asked for CI/CD. A deploy needs something to restart. This covers the app part of Phase 4 (N2).                                                             | No. See `docs/deployment.md`.               |

## Progress

P2.1 to P2.8 are done and committed. CI and deploy are live (see `docs/deployment.md`). The host runs the Phase 2 build under systemd.

- Server: `server/src/pi-adapter.ts` (`PiAdapter`, `PiSession`), `open-session.ts`, `session-hub.ts`, `transport.ts`. Tests: 35 pass in `server/test`.
- Client: `web/src/workspace.ts` (state), `connection.ts` (reconnect and backoff), `components/SessionSidebar.vue`. Tests: 9 pass in `web/test`.
- Exit check, on the host: the user confirmed that a session started on one device continues on another.
- Local evidence: a tab started a `sleep 6` run and closed. A second desktop tab and a 375 px tab opened the session URL and showed the run, then the result.
- The session URL holds the session ID in the hash.
- On a phone, the session panel opens from a bottom bar, and its list sits at the bottom, so every control is in reach of a thumb.

Not checked: the Stop button in a browser (the server abort path has a test), a real network drop on a mobile network, and the size of a snapshot on a long session (spec open question 3).

## Handoff

Next step: start Phase 3 (a usable agent UI). Open `docs/phases/` and copy the template for `phase-3-agent-ui.md`.
Blockers: none.
How to check the current state: `npm test`, `npm run check`, `npm run build`. For the host: `systemctl --user status pi-remote` and `journalctl --user -u pi-remote -f`.
