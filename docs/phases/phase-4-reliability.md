# Phase 4: Make it reliable

Status: In progress
Last updated: 2026-10-29 (tool runs fold into one row; MCP support still uncommitted)

## Goal

Run the server without attention. It starts after a host reboot and recovers after a crash. See [roadmap Phase 4](../roadmap.md#phase-4-make-it-reliable).

## Read first

- `docs/spec.md`: N2, failure handling, and security.
- `docs/roadmap.md`: Phase 4.
- `docs/deployment.md`: service setup and continuous deployment.
- `docs/phases/phase-3-agent-ui.md`: Handoff.

## Scope

In scope: service recovery, automatic security updates, EBS snapshots, failure states, structured logs, clean shutdown, and the reboot exit check.
Out of scope: notifications, tool approval, file browsing, terminals, attachments, and MCP.

## Tasks

- [x] P4.1 Verify service recovery. Done when: the app, authentication server, and proxy recover after failures and a host reboot.
- [x] P4.2 Enable automatic OS security updates. Done when: the host reports an active update timer and a successful dry run.
- [ ] P4.3 Schedule EBS snapshots. Done when: AWS shows a scheduled snapshot and a restore procedure exists in the deployment guide.
- [x] P4.4 Verify failure states. Done when: browser checks cover disconnected, reconnecting, expired login, and server errors.
- [ ] P4.5 Add structured logs. Done when: each command and run writes one JSON log line with useful context.
- [ ] P4.6 Verify clean shutdown. Done when: tests show that shutdown aborts active runs and disposes every open session.
- [ ] P4.7 Exit check. Done when: the host reboots, the client reconnects, and an old session opens without manual steps.

## Known facts

- Phase 2 added the app service, CI deployment, and the restricted deploy key.
- The host uses a systemd user service with lingering enabled.
- A push to `main` runs tests before deployment and checks `/api/ping` after restart.
- The host has no GitHub credential for the private repository. Copy deploy files from the Mac with `scp`.
- `bindExtensions` is new. Extension files in `~/.pi/agent/extensions` now see `session_start` on every session, so an extension that worked silently before can now act. Extension `ctx.ui` calls stay no-ops until the UI bridge exists.
- Sessions created with an explicit `agentDir` (tests and sandboxes) start with an empty MCP server list: the MCP extension reads its configuration with `getAgentDir()`, which ignores `options.agentDir`, so `PiAdapter` swaps in an empty loader for that case. The production path (no `agentDir`) uses the extension's own loader at full fidelity.
- The MCP extension failure reports go to `ctx.ui.notify`, so they are invisible today. A failed connection shows up first as the model failing to find a tool.
- The `pi-remote.service` PATH change lands on the host only when `install-service.sh` runs again or the unit is edited by hand. The `easy-install.sh`-installed copy of the unit on an existing host keeps the old PATH until then.

## Decisions

| Decision                                                                                                         | Reason                                                                                                                                                 | Spec changed?                       |
| ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------- |
| Keep the existing systemd user service and CI deployment.                                                        | They already run the app as the host user and protect the local configuration.                                                                         | No                                  |
| Load the `codemode`, `tool_search`, and MCP extensions in `PiAdapter` and call `bindExtensions({})`.             | SDK sessions leave them out; this adds MCP and runs extension `session_start` handlers for the first time. The user pulled this Phase 5 extra forward. | Yes, the D1 note in `docs/spec.md`. |
| Keep MCP server settings with pi (`~/.pi/agent/mcp.json`, `pi mcp` commands) instead of adding pi remote fields. | One source of truth; the `pi mcp` shell commands already cover add, remove, list, and headless OAuth login.                                            | No                                  |

## Progress

P4.1 is complete. The app restarted after a forced `SIGKILL`. Its PID changed from 16390 to 16497, and `NRestarts` increased to 1.

The app also started after a host reboot with PID 791. Its local `/api/ping` endpoint returned 204 without a manual start.

That reboot stopped the manually run Caddy and Authelia processes. Public HTTPS refused connections while the app remained healthy on port 7710.

Commit `8c6970e` added systemd user services for Caddy and Authelia. The user copied and installed the units on the host.

All three services became active. The public route reached the Authelia login page through Caddy. After the final reboot, `check-services.sh` reported all three active, app 204, healthy Authelia, and Caddy 302. A forced `SIGKILL` restarted Authelia from PID 817 to 1248 and Caddy from PID 819 to 1270. The full-stack check passed again.

The first health check ran before Authelia opened port 9091. Commit `457463d` added readiness retries and a regression test.

The updated readiness-aware check script is installed on the host.

P4.2 is complete. `apt-daily-upgrade.timer` is enabled and active. `sudo unattended-upgrade --dry-run --debug` succeeded and allowed Ubuntu Noble security origins.

P4.4 is complete. `web/test/browser/failure-states.test.ts` mocks WebSocket and HTTP failures in an isolated headless browser. It verifies the visible server error, the reconnecting state after a disconnect, automatic reconnect and resubscription, and a page reload when `/api/ping` returns 403. The production browser suite passes at 375 px and 1280 px plus the failure-state check.

The user requested an out-of-scope provider-settings feature during Phase 4. The global `#settings` page lists only non-secret AI-provider status. It can add an API key through the provider's own pi key login, start and cancel OAuth logins, show provider URLs and device codes, accept provider prompts, edit a saved key, and sign out. The server saves keys to pi's `auth.json`, so they survive a restart. The list never contains keys. The edit row asks for one key with `get_provider_key`, so the server sends that key to a signed-in browser on request. Protocol, unit, and isolated browser tests cover the flow.

The user also requested root-based projects during Phase 4. `projectsRoot` is now required and is the only project source. The old `projects` array is rejected. The client labels the existing group flow as New project and Create project. Local `config.local.json` uses `/Users/you/Code` and registers `/Users/you/Code/pi-web`. EC2 uses `/home/ubuntu` and registers `/home/ubuntu/pi-remote`. The first deployment failed because EC2 still had the legacy `projects` array. Removing it restored the service, and the failed deployment rerun passed.

The summary behavior now matches the requested lifecycle. `SessionSummaryJob` makes one initial title attempt after the first response, then checks periodically. Periodic requests return `UNCHANGED` unless the conversation has moved to a substantially different task or project. Tests cover the initial title, unchanged periodic checks, accepted replacement titles, stale results, busy sessions, and retries. `npm test -w server` passes with 100 tests.

The client already has reconnect and expired-login behavior. Phase 4 must verify all required failure states together.

Later out-of-scope requests from the user, all on `main`:

- The add provider dialog follows the frappe-ui wizard pattern. Choosing API key runs the provider's own key login, so there is no Guided setup button.
- The new project form sits in the header. Projects can be collapsed, removed from the list, or deleted with their folder. Folder deletion refuses any path that is not directly inside `projectsRoot`.
- On mobile, the header sits at the bottom of the session list and settings, and their content aligns to the bottom.
- Messages sent during a run queue as follow-ups. Send now moves one follow-up to the steer queue through `steer_follow_up`. The server uses pi's internal `_queueSteer` and `_queueFollowUp` for this, because pi has no public way to remove one queued message.
- Session summary requests pass `sessionId`, which OpenCode Go requires.
- The user reported broken session summaries on OpenCode Go models. Those models spend a large budget on reasoning before they answer, and the old limit of 80 output tokens cut the title off mid-sentence or removed it entirely. The summary job now allows 2048 output tokens and reads the title from the last nonempty text line, because reasoning models can put their train of thought in plain text before the answer. It also strips wrapping quotes. Reasoning-heavy models `deepseek-v4.1-flash` and `kimi-k3` return complete titles now, checked live.
- The viewport sets `maximum-scale=1` so iOS does not zoom on focused inputs.
- `/name <title>`, `/compact [instructions]`, and `/session` run in pi remote. Other slash commands still go to pi. A manual name adds a `pi-remote.manual-name` custom entry, so the summary job stops renaming that session, also after a reopen. `/session` and a rename add a local note to the transcript. pi never sees notes, and they last until you leave the session.
- The composer suggests slash commands: pi remote's own, extension commands, prompt templates, and `skill:` commands. The server sends pi's list in the session settings.
- Push notifications: an optional `push` object in the configuration turns them on. `PushNotifier` keeps the VAPID keys and device subscriptions in `push.file` and sends Web Push straight to each push service. No relay is needed. Settings has a Push notifications switch and a test button. Where the browser has no Web Push, such as iOS Safari outside the Home Screen app, turning the switch on shows a toast that explains how to add the app to the Home Screen. The service worker skips the notice when that session is on screen. The first version compared the client URL's hash, but a client URL is its creation URL and never gains the hash the app sets later, so it suppressed nothing. The worker now asks the page which session it shows and drops the notice when a visible page answers with the session of the notice. `easy-install.sh` turns push on for new installs.
- Faster session load. The longest EC2 session (frappe) had 2.5 MB of messages, and 1.8 MB of that was nine base64 images in tool results. The client never shows images, so the server now leaves out image data in snapshots and events. WebSocket compression (`perMessageDeflate`) is on, which brings the rest from 720 KB to about 180 KB on the wire. The transcript renders the last 60 messages first and adds 60 more each time you scroll near the top.
- The app shell pads the safe areas and sets `viewport-fit=cover`, so the bottom bar clears the iOS home indicator in the installed app.
- The installed app's status bar stayed white in dark mode, because iOS paints it from the manifest `theme_color` (`#ffffff`) and the page had no `theme-color` meta. `web/index.html` now sets `theme-color` and `color-scheme`, both before first paint and on every scheme change through `web/src/browser-theme.ts`. Dark uses `#171717`, the `surface-base` token. The browser test checks both meta tags after a manual and a system theme change. The user confirmed the fix on an iPhone.
- Commit `11406c6` let the model list scroll on mobile. The drawer grow gesture was bound to the whole settings panel, so a swipe on a model row grew the drawer and its `preventDefault` blocked the list's native scroll. The gesture now ignores touches that start on a form field or inside a scrollable region. A browser test covers it.
- Commit `a335766` fixed a flaky provider login test. It spun 20 `setImmediate` ticks for a WebSocket round-trip and lost the race under load. It now polls every 10 ms for up to five seconds.
- Image attachments in prompts, a Phase 5 extra pulled forward. The composer shows a ghost paperclip on models whose `input` includes `image`, via `hasImageInput` on `ModelChoice`. The browser downscales to 1568 px and sends base64 with the `prompt` command; the server validates at most four images of 8 MB each and passes them to `session.prompt` as `ImageContent`. Images ride in a prompt frame, so the WebSocket frame limit rose from 64 KB to 12 MB. The server still leaves image data out of everything it sends, so the transcript shows a placeholder for image blocks. Queued messages stay text-only, and the paperclip hides while a run is active.
- The host's SearXNG settings replaced the repo defaults. `deploy/searxng/settings.yml` now sets `image_proxy`, `default_lang`, 6 s and 10 s request timeouts, and engine choices with weights on `brave` and `google cse`. `seznam` stays off. `docs/deployment.md` gains a SearXNG section. `install.sh` keeps an existing host file, so a running host copies the file by hand and restarts the service.
- The session list now updates while it is open. Before, the client only refreshed the list on run events for the session it had open, so the Working dot went stale on the home page and after backing out of a running session. The server now pushes a session list to every connected socket when a run starts or settles, when a name changes, when a session opens, and when an idle session is disposed. `SessionHub.scheduleListBroadcast` debounces these into one send with a `push: true` flag, so tests and clients can tell pushes from command replies. `Transport.connect` registers each socket with the hub, and the client refreshes the list when it returns to the home page.
- The Default model row label is now "New sessions". The old label "Model for new sessions" wrapped to two lines at 375 px because the label only had about 162 px of the row. The label and the value now truncate instead of wrapping, so the row stays one line. The browser test clicks the new name.

- The client now reports a final provider run error, such as a quota or session limit, with a toast. Retryable errors wait until pi emits a final `agent_end`; the inline composer error remains for command and server errors. Workspace unit and isolated browser tests cover the toast.
- Default model setting, requested during Phase 4. Settings has a Default model section with a searchable picker that lists Automatic plus the models of the active providers. The server stores the choice in pi's global settings (`defaultProvider` and `defaultModel`) and new sessions read it in this order: the stored default when its provider still has a login, then a model passed explicitly in the adapter options, then pi's own automatic pick from the active providers. Signing out of the provider of the stored default clears it, so new sessions pick automatically again, and the settings row falls back to Automatic because `getDefaultModel` only reports a stored default that is still available. Open sessions keep their own model, and a reopen falls back automatically when its saved model's provider is gone (pi's own restore logic). `get_default_model` and `set_default_model` commands carry the model list and the stored choice; the server also sends `default_model` after every provider change. The old `model` field in config.json is removed: the configuration rejects it with a pointer to the app setting, like the legacy `projects` array. Existing host configs must drop the field before the new server starts.
- One new session per project, requested during Phase 4. `SessionHub` keeps a draft session id for each project. A New session command returns that session while it is open, not running, and has no messages. The draft is cleared when its first run emits `agent_start`, when it is deleted, and when it is disposed. Concurrent commands for one project share one create promise. Tests cover reuse, concurrent creates, the first run, deletion, and disposal. Committed in `8e64a3a`.

The settings screen now has a Providers section. It lists connected providers only. A `+` button opens a searchable list of provider and sign-in method pairs, such as OpenAI with ChatGPT or an API key. The UI uses gray tokens. Red marks errors only.

The user reported a red alert that said "Not connected. Reconnecting." while the session kept working. A send that lands between a dead socket and its close event throws that error, and the alert used to stay after the reconnect. `Connection` now exports `NOT_CONNECTED_MESSAGE`, and `Workspace.handleStatus` clears the error once the socket is connected again. A server error still stays until the next action. The composer also keeps the draft and its images when a send cannot go out: `Workspace.sendPrompt` returns a boolean and `Composer` clears only on true. `Workspace.is_disabled` checks the live socket too, so the send button is off while the socket is down. Unit tests in `web/test/workspace.test.ts` cover both cases. A browser check in `web/test/browser/failure-states.test.ts` types a bare `/name`, which fails without a socket round trip, and asserts the draft stays. That check runs against a fake server started by the shared `startApp` helper in the same file.

MCP, `codemode`, and `tool_search`, a Phase 5 extra the user pulled forward. `PiAdapter` now builds a `DefaultResourceLoader` per session with the three extension factories and a `SettingsManager` for the project, passes it plus the same `SettingsManager` to `createAgentSession`, and calls `session.bindExtensions({})`, so `session_start` fires and MCP servers connect in the background. MCP servers come from `~/.pi/agent/mcp.json` and the project's trusted `.pi/mcp.json`, configured with the `pi mcp` shell commands. `PiSession.close()` now emits `session_shutdown` before `dispose()`, which the MCP extension needs to close stdio servers, because `dispose()` alone does not emit it. `/mcp` is hidden from the client command list until the extension UI bridge exists: without `uiContext` every `ctx.ui` call is a no-op, so it could not sign in, list, or reconnect. Tests in `server/test/pi-adapter.test.ts` use a `FauxMcpServer` over `@earendil-works/pi-mcp/testing`'s in-memory transport pair: one proves the factories register without servers, one proves the configured exposures activate `codemode` and `tool_search` even when the connection fails, and one runs a codemode script that calls `mcp__faux__ping` end to end, reads the result, checks the recorded nested call, and verifies that `session_shutdown` closes the server. `npm test -w server` passes with 104 tests. `deploy/pi-remote.service` gains `Environment=PATH=%h/.local/bin:/usr/local/bin:/usr/bin:/bin`, because a systemd user service does not use `~/.local/bin` where `easy-install.sh` links `npm` and `npx`, and `deploy/test_service_setup.py` asserts it. `docs/deployment.md` gains an MCP section.

The session list now orders by the last message the user sent, not the last activity. A running reply no longer moves a chat. On desktop the project and chat with the last user message come first. On a phone the same list is reversed, so that chat sits at the bottom next to the header. The server reads each session file once, then only the lines added since the last read, and sends `lastUserMessage` with the list. `SessionHub` sorts by it, and `orderProjects` sorts and reverses for the layout. Tests cover the file reader, the hub order, the client order, and both viewport orders in a browser. Committed in `5c781db`.

The session list now shows the first three sessions in each project. A View all item opens a project page with every session in that group. The page uses a hash route, has a back button, and keeps session ordering on desktop and phone. Protocol and browser tests cover the route and page.

Tool runs fold into one row. When three or more tool calls run back to back, the transcript shows a single row that says "Ran N commands" with the status of the whole run; a tap expands the cards and their thinking blocks. A shorter run keeps its cards. `web/src/tool-runs.ts` builds the rows from the transcript and skips empty streaming messages and tool results that render inside a card, so a run survives a reply that is still streaming. `web/src/components/ToolRun.vue` renders a run, `ThinkingBlock.vue` is shared with `MessageItem.vue`, and `ToolCard` has a flat variant for the expanded rows. Unit tests in `web/test/tool-runs.test.ts` cover grouping, the minimum size, and the breaks on text, on thinking alone, and on output without a card. The browser check in `web/test/browser/tool-runs.test.ts` folds a three-call run at 375 and 1280 px, expands it, and leaves a two-call run open. `npm test` passes with 104 server and 60 web tests, and `npm run check` passes for both workspaces. The browser check is unverified on this Linux host: the cached headless shell cannot start because `libatk-1.0.so.0` and the other browser libraries are missing. Run it on a machine with a browser when one is available.

## Handoff

The user pulled the MCP extra forward and approved commit. Commit `0fcd7dd` (`feat(server): bind codemode, tool_search, and MCP extensions`) holds `server/src/pi-adapter.ts` and its tests: the extension factories, `bindExtensions`, `session_shutdown` on close, `/mcp` filtered from client commands, the spec D1 note, and the roadmap updates. Commit `32563da` (`fix(deploy): put easy-install links on the app service PATH`) holds the unit PATH line and its assertion. Note: `npx` is missing from this Mac login shell's PATH, so husky's pre-commit needs `export PATH="$HOME/.local/bin:$PATH"` before `git commit`; the hook then runs prettier, both workspaces' checks, and their full unit suites (104 server, 60 web), all green. The docs commit lands after this paragraph. The host steps stay as below: reinstall the service unit, then configure servers with `pi mcp add` and check with `pi mcp list`. UI follow-ups for MCP live in the roadmap and the deck in this doc's Progress: argument previews, nested-call rows, the extension UI bridge, then the `/mcp` manager and OAuth sign-in.

This commit adds the web-only tool run change: `web/src/tool-runs.ts`, `web/src/components/ToolRun.vue`, `web/src/components/ThinkingBlock.vue`, the `isFlat` prop in `web/src/components/ToolCard.vue`, the folded render loop in `web/src/App.vue`, and the new unit and browser tests. It needs no server change, so it deploys with the client build. Its browser check has not run anywhere yet, because this Linux host has no browser libraries. Run `npm run test:browser -w web` on the Mac when one is available.

When this deploys, the host checkout needs two things beyond the push: a full `npm ci` followed by reinstalling the service unit (`bash deploy/install-service.sh`), and, for MCP, servers configured with `pi mcp add` on the host and verified with `pi mcp list`.

An earlier session's note, for history: the current working tree included an uncommitted fix for session summaries on OpenCode Go models. That change is committed in `6a43147` and pushed.

The deploy job then failed with `receive.sh: line 20: npm: command not found`. The agent ran `easy-install.sh` on the host on Oct 28 19:17 to 19:19, and that setup links npm and node only in `~/.local/bin`. sshd gives a restricted command a minimal PATH, so the forced command could not run npm. A temporary diagnostic key confirmed the PATH. The uncommitted change adds `~/.local/bin` to `PATH` at the top of `deploy/receive.sh` and documents it in `docs/deployment.md`. CI never ships `receive.sh`, so pulling main in the host checkout brings the fix to the copy the forced command runs.

One host decision is still open: the authorized_keys forced command points at `~/projects/pi-remote/deploy/receive.sh`, so deploys install there, while `pi-remote.service` runs `~/pi-remote`. The two checkouts also hold different code now. The deploys must land in the checkout the service serves, or the restart serves stale code. Ask the user which checkout is the deploy target and repoint either the service or the forced command.

The deploy-key repair is now part of the toolkit. `deploy/deploy-key.sh` installs or replaces the forced-command line for the current checkout; `DEPLOY_KEY_PUB` makes `easy-install.sh` run it as its last step; `deploy/receive.sh` adds `~/.local/bin` to `PATH`; `deploy/install-service.sh` warns when the deploy key points at a different checkout; `docs/deployment.md` documents all of it. Every script passes `bash -n`, and `deploy-key.sh` was tested in a sandbox HOME for replace, empty file, missing file, rerun, and bad input. `npm test -w server` passes with 101 tests. The user approved committing and pushing these deploy changes and repairing the host deploy key to target `~/pi-remote`, the served checkout.

The repository is public at `github-user/pi-remote` as of 2026-10-27. Before the flip, one history rewrite removed personal strings from git history: a fresh clone of origin gained a `git filter-repo --invert-paths --path docs/phases --path docs/deployment.md` rewrite that pruned 5 docs-only commits, and one commit re-added the scrubbed phase docs and deployment guide (domain, public IP, usernames, paths, PEM name, and AWS instance ID replaced with placeholders; old commit hashes in the docs remapped to their new values). All code history survived with identical author, date, and blame. The old 130-commit chain exists only under the old local clone and must never be pushed again. `the first client commit is now `1589356` (`feat: add basic pi-remote web client`); `.git-blame-ignore-revs`still points at a valid hash. Commit 8032a66 added the MIT LICENSE and ignores`config.local.json*`and`_.bak_`. Note: the host checkout cannot run the husky pre-commit hook because `npm ci --omit=dev`removes prettier; local commits here need`--no-verify` or a full dev install. Working-tree commits pending at the time (scroll-button fixes, default model, SearXNG, list broadcast) were all already pushed before the rewrite.

What remains, in order:

1. P4.5 structured logs. Next task.
2. P4.6 clean shutdown.
3. P4.7 exit check. The user must log in after a reboot and open an old session.
4. P4.3 EBS snapshots. Deferred at the user's request until AWS access is available. Then document the restore procedure in `docs/deployment.md`.

Everything in Progress before this session was committed. Commit `a05521e` adds the provider error toast in `web/src/App.vue`, `web/src/workspace.ts`, `web/test/workspace.test.ts`, and `web/test/browser/failure-states.test.ts`. The current working tree contains the project session page in `web/src/components/SessionList.vue`, `web/src/protocol.ts`, `web/src/workspace.ts`, `web/src/App.vue`, `docs/spec.md`, and related tests. The full browser suite passes. The one-draft-session change (`server/src/session-hub.ts`, `server/src/open-session.ts`, their tests, and `docs/spec.md`) is committed. The session order change (`server/src/session-activity.ts`, `server/src/pi-adapter.ts`, `server/src/session-hub.ts`, `web/src/protocol.ts`, `web/src/components/SessionList.vue`, `docs/spec.md`, and their tests) is committed in `5c781db`; the full browser suite passed. The status bar fix (`web/index.html`, `web/src/App.vue`, `web/src/browser-theme.ts`, and `web/test/browser/provider-settings.test.ts`) was checked on the user's iPhone and is committed. A deploy replaces `server/src` from the pushed commit, so uncommitted server changes do not survive a push. A deploy also runs `npm ci --omit=dev`; run a full `npm ci` before local checks.

Push follow-ups, out of scope and not started. Do them only when asked:

- The service worker skips the notice when that session is on screen. Safari can revoke a subscription after pushes that show no notification. This is not verified on a device. The proposed fix: the server skips the send while the session is open on that device, and the service worker always shows the notice.
- The client sends its subscription to the server again only when Settings opens. The proposed fix: send it again at every app start, so the server gets a changed subscription soon.

Push is on in EC2: `config.local.json` has a `push` object, and the keys are in `~/.config/pi-remote/push.json`. The config before this change is in `config.local.json.bak-before-push`. To use push, add the app to an iPhone Home Screen and turn on Push notifications in Settings. If `push.json` is lost, each device must turn push on again.

Blockers: P4.3 needs access to the AWS account. P4.7 needs the user.
Watch: the server leaves image data out of everything it sends. Image attachments will need a way to send images, such as a separate request per image.
Watch: a pi version update can change the internal queue methods that Send now uses. The adapter test "steers a queued follow-up once" fails if they change.
How to check the current state: `npm test`, `npm run check`, and `python3 -m unittest deploy.test_service_setup -v` pass. Run `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/Users/you/Library/Caches/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-mac-arm64/chrome-headless-shell npm run test:browser -w web` for the isolated browser checks. On the host, run `bash deploy/check-services.sh pi.example.com`; it should report three active services, app 204, healthy Authelia, and Caddy 302.
