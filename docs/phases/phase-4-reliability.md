# Phase 4: Make it reliable

Status: In progress
Last updated: 2026-10-27 (repo made public; history rewritten; remaining work and push follow-ups listed)

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

## Decisions

| Decision                                                  | Reason                                                                         | Spec changed? |
| --------------------------------------------------------- | ------------------------------------------------------------------------------ | ------------- |
| Keep the existing systemd user service and CI deployment. | They already run the app as the host user and protect the local configuration. | No            |

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

Commit `cdccbd1` removed the repeating session-summary timer. Summaries now run only after a conversation changes.

The client already has reconnect and expired-login behavior. Phase 4 must verify all required failure states together.

Later out-of-scope requests from the user, all on `main`:

- The add provider dialog follows the frappe-ui wizard pattern. Choosing API key runs the provider's own key login, so there is no Guided setup button.
- The new project form sits in the header. Projects can be collapsed, removed from the list, or deleted with their folder. Folder deletion refuses any path that is not directly inside `projectsRoot`.
- On mobile, the header sits at the bottom of the session list and settings, and their content aligns to the bottom.
- Messages sent during a run queue as follow-ups. Send now moves one follow-up to the steer queue through `steer_follow_up`. The server uses pi's internal `_queueSteer` and `_queueFollowUp` for this, because pi has no public way to remove one queued message.
- Session summary requests pass `sessionId`, which OpenCode Go requires.
- The viewport sets `maximum-scale=1` so iOS does not zoom on focused inputs.
- `/name <title>`, `/compact [instructions]`, and `/session` run in pi remote. Other slash commands still go to pi. A manual name adds a `pi-remote.manual-name` custom entry, so the summary job stops renaming that session, also after a reopen. `/session` and a rename add a local note to the transcript. pi never sees notes, and they last until you leave the session.
- The composer suggests slash commands: pi remote's own, extension commands, prompt templates, and `skill:` commands. The server sends pi's list in the session settings.
- Push notifications: an optional `push` object in the configuration turns them on. `PushNotifier` keeps the VAPID keys and device subscriptions in `push.file` and sends Web Push straight to each push service. No relay is needed. Settings has a Push notifications switch and a test button. Where the browser has no Web Push, such as iOS Safari outside the Home Screen app, turning the switch on shows a toast that explains how to add the app to the Home Screen. The service worker skips the notice when that session is on screen. The first version compared the client URL's hash, but a client URL is its creation URL and never gains the hash the app sets later, so it suppressed nothing. The worker now asks the page which session it shows and drops the notice when a visible page answers with the session of the notice. `easy-install.sh` turns push on for new installs.
- Faster session load. The longest EC2 session (frappe) had 2.5 MB of messages, and 1.8 MB of that was nine base64 images in tool results. The client never shows images, so the server now leaves out image data in snapshots and events. WebSocket compression (`perMessageDeflate`) is on, which brings the rest from 720 KB to about 180 KB on the wire. The transcript renders the last 60 messages first and adds 60 more each time you scroll near the top.
- The app shell pads the safe areas and sets `viewport-fit=cover`, so the bottom bar clears the iOS home indicator in the installed app.
- Commit `11406c6` let the model list scroll on mobile. The drawer grow gesture was bound to the whole settings panel, so a swipe on a model row grew the drawer and its `preventDefault` blocked the list's native scroll. The gesture now ignores touches that start on a form field or inside a scrollable region. A browser test covers it.
- Commit `a335766` fixed a flaky provider login test. It spun 20 `setImmediate` ticks for a WebSocket round-trip and lost the race under load. It now polls every 10 ms for up to five seconds.
- Image attachments in prompts, a Phase 5 extra pulled forward. The composer shows a ghost paperclip on models whose `input` includes `image`, via `hasImageInput` on `ModelChoice`. The browser downscales to 1568 px and sends base64 with the `prompt` command; the server validates at most four images of 8 MB each and passes them to `session.prompt` as `ImageContent`. Images ride in a prompt frame, so the WebSocket frame limit rose from 64 KB to 12 MB. The server still leaves image data out of everything it sends, so the transcript shows a placeholder for image blocks. Queued messages stay text-only, and the paperclip hides while a run is active.
- The host's SearXNG settings replaced the repo defaults. `deploy/searxng/settings.yml` now sets `image_proxy`, `default_lang`, 6 s and 10 s request timeouts, and engine choices with weights on `brave` and `google cse`. `seznam` stays off. `docs/deployment.md` gains a SearXNG section. `install.sh` keeps an existing host file, so a running host copies the file by hand and restarts the service. This change is not committed yet.
- The session list now updates while it is open. Before, the client only refreshed the list on run events for the session it had open, so the Working dot went stale on the home page and after backing out of a running session. The server now pushes a session list to every connected socket when a run starts or settles, when a name changes, when a session opens, and when an idle session is disposed. `SessionHub.scheduleListBroadcast` debounces these into one send with a `push: true` flag, so tests and clients can tell pushes from command replies. `Transport.connect` registers each socket with the hub, and the client refreshes the list when it returns to the home page. This change is not committed yet.
- The Default model row label is now "New sessions". The old label "Model for new sessions" wrapped to two lines at 375 px because the label only had about 162 px of the row. The label and the value now truncate instead of wrapping, so the row stays one line. The browser test clicks the new name.
- Default model setting, requested during Phase 4. Settings has a Default model section with a searchable picker that lists Automatic plus the models of the active providers. The server stores the choice in pi's global settings (`defaultProvider` and `defaultModel`) and new sessions read it in this order: the stored default when its provider still has a login, then a model passed explicitly in the adapter options, then pi's own automatic pick from the active providers. Signing out of the provider of the stored default clears it, so new sessions pick automatically again, and the settings row falls back to Automatic because `getDefaultModel` only reports a stored default that is still available. Open sessions keep their own model, and a reopen falls back automatically when its saved model's provider is gone (pi's own restore logic). `get_default_model` and `set_default_model` commands carry the model list and the stored choice; the server also sends `default_model` after every provider change. The old `model` field in config.json is removed: the configuration rejects it with a pointer to the app setting, like the legacy `projects` array. Existing host configs must drop the field before the new server starts. This change is not committed yet.

The settings screen now has a Providers section. It lists connected providers only. A `+` button opens a searchable list of provider and sign-in method pairs, such as OpenAI with ChatGPT or an API key. The UI uses gray tokens. Red marks errors only.

## Handoff

The repository is public at `github-user/pi-remote` as of 2026-10-27. Before the flip, one history rewrite removed personal strings from git history: a fresh clone of origin gained a `git filter-repo --invert-paths --path docs/phases --path docs/deployment.md` rewrite that pruned 5 docs-only commits, and one commit re-added the scrubbed phase docs and deployment guide (domain, public IP, usernames, paths, PEM name, and AWS instance ID replaced with placeholders; old commit hashes in the docs remapped to their new values). All code history survived with identical author, date, and blame. The old 130-commit chain exists only under the old local clone and must never be pushed again. `the first client commit is now `1589356` (`feat: add basic pi-remote web client`); `.git-blame-ignore-revs` still points at a valid hash. Commit 8032a66 added the MIT LICENSE and ignores `config.local.json*` and `*.bak*`. Note: the host checkout cannot run the husky pre-commit hook because `npm ci --omit=dev` removes prettier; local commits here need `--no-verify` or a full dev install. Working-tree commits pending at the time (scroll-button fixes, default model, SearXNG, list broadcast) were all already pushed before the rewrite.

What remains, in order:

1. P4.5 structured logs. Next task.
2. P4.6 clean shutdown.
3. P4.7 exit check. The user must log in after a reboot and open an old session.
4. P4.3 EBS snapshots. Deferred at the user's request until AWS access is available. Then document the restore procedure in `docs/deployment.md`.

The SearXNG settings change waits for the user's commit approval. The session list broadcast fix (`open-session.ts`, `session-hub.ts`, `transport.ts`, `workspace.ts` and their tests) also waits for approval. The default model setting (`pi-adapter.ts`, `config.ts`, `transport.ts`, `workspace.ts`, `App.vue`, `ProviderSettings.vue`, their tests, and spec.md sections) waits for the user's commit approval too. The host's `config.json` still holds the removed `model` field, so deployment fails until it is deleted there. `server/src/pi-adapter.ts` also holds uncommitted edits from earlier work on `main`. `web/src/App.vue` also holds another agent's in-flight scroll-button work, so a commit needs care to split the changes.

Push follow-ups, out of scope and not started. Do them only when asked:

- The service worker skips the notice when that session is on screen. Safari can revoke a subscription after pushes that show no notification. This is not verified on a device. The proposed fix: the server skips the send while the session is open on that device, and the service worker always shows the notice.
- The client sends its subscription to the server again only when Settings opens. The proposed fix: send it again at every app start, so the server gets a changed subscription soon.

Push is on in EC2: `config.local.json` has a `push` object, and the keys are in `~/.config/pi-remote/push.json`. The config before this change is in `config.local.json.bak-before-push`. To use push, add the app to an iPhone Home Screen and turn on Push notifications in Settings. If `push.json` is lost, each device must turn push on again.

Blockers: P4.3 needs access to the AWS account. P4.7 needs the user.
Watch: the server leaves image data out of everything it sends. Image attachments will need a way to send images, such as a separate request per image.
Watch: a pi version update can change the internal queue methods that Send now uses. The adapter test "steers a queued follow-up once" fails if they change.
How to check the current state: `npm test`, `npm run check`, and `python3 -m unittest deploy.test_service_setup -v` pass. Run `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/Users/you/Library/Caches/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-mac-arm64/chrome-headless-shell npm run test:browser -w web` for the isolated browser checks. On the host, run `bash deploy/check-services.sh pi.example.com`; it should report three active services, app 204, healthy Authelia, and Caddy 302.
