# Phase 5: Extras

Status: In progress
Last updated: 2026-11-01

## Goal

Build the roadmap's Phase 5 extras, in the order the user asks for them. Each one is independent. See [roadmap Phase 5](../roadmap.md#phase-5-extras). This doc also holds the extras the user pulled forward while Phase 4 was still open, so Phase 4 stays reliability-only.

## Read first

- `docs/roadmap.md`: Phase 5 and the gaps table against pi's terminal app.
- `docs/spec.md`: the D1 note on the loaded pi extensions, and the D6 tool approval decision.
- `docs/phases/phase-4-reliability.md`: Handoff, for what the phase 4 sessions already did.

## Scope

In scope: the roadmap Phase 5 items, in this doc's task order, plus whatever the user pulls forward next.
Out of scope: the Phase 4 reliability tasks. They live in [phase-4-reliability](phase-4-reliability.md).

## Tasks

- [x] P5.1 Load pi's `codemode`, `tool_search`, and MCP extensions in `PiAdapter`. Done when: sessions bind the extensions, a configured MCP server's tools are callable from a codemode script, and the server closes on session shutdown.
- [x] P5.2 Give the app service PATH for stdio MCP servers. Done when: the installed unit carries `~/.local/bin` on PATH and its check passes.
- [x] P5.3 MCP transcript UI. Done when: the browser suite passes for the folded-run and card paths alongside the new unit tests. The full 20-check browser run passed on this host with Chromium's system libraries in place, so the earlier Mac-only condition no longer binds.
- [ ] P5.4 MCP settings and management UI. Done when: a Settings section lists servers with state, the extension UI bridge shows MCP errors as visible messages, and OAuth sign-in accepts a pasted redirect URL.
- [ ] P5.5 Tool approval (D6). Done when: a gate extension blocks risky calls and the client shows the confirm dialog.
- [x] P5.6 Type-to-focus composer. Done when: a printable key typed while focus is elsewhere in a session view focuses the message box and the first character appears in it.
- [ ] P5.7 A file browser for the project.
- [ ] P5.8 A terminal tab (xterm.js).

Push notifications (an original Phase 5 item) and image attachments were pulled forward and finished during Phase 4; image input is recorded in phase 4's Progress. Push follow-ups from phase 4's Handoff stay there until the user asks.

## Known facts

- The MCP extension reads its configuration with `getAgentDir()`, not the session's `agentDir`, so adapter sessions with an explicit `agentDir` (tests, sandboxes) get an empty server list; the production path uses the extension's own loader at full fidelity.
- Server settings belong to pi: `~/.pi/agent/mcp.json` and `pi mcp` shell commands. No pi remote configuration fields exist for MCP.
- Extension failures today are invisible: without a UI bridge, every `ctx.ui.notify` is a no-op. The first sign of a failed server is the model missing a tool.
- OAuth for `url` servers uses a loopback callback on the host; the phone cannot reach it. The supported headless flow is pasting the redirect URL, which needs a real dialog in the client.
- The frappe org's own MCP app (`github.com/frappe/mcp`) is deprecated; Frappe Framework ships a built-in server now. If a Frappe site becomes an MCP server for pi remote, it is a `url` entry, the OAuth case above.
- MCP transcript data needs no protocol change: nested calls arrive as `tool_execution_*` events with `parentToolCallId` and as `nestedCalls` on the tool result message.

## Decisions

| Decision                                                                                                                             | Reason                                                                                                              | Spec changed?                       |
| ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| Load the `codemode`, `tool_search`, and MCP extensions in `PiAdapter` and call `bindExtensions({})`.                                 | SDK sessions leave them out; this adds MCP and runs the extension `session_start` handlers for the first time.      | Yes, the D1 note in `docs/spec.md`. |
| Keep MCP server settings with pi (`~/.pi/agent/mcp.json`, `pi mcp` commands) instead of adding pi remote fields.                     | One source of truth; the shell commands already cover add, remove, list, and headless login.                        | No                                  |
| Hide `/mcp` from the client command list until the UI bridge exists.                                                                 | Without `uiContext`, the manager's menus and sign-in are no-ops.                                                    | No                                  |
| Build the MCP UI in two steps: transcript readability and nested rows first, then the extension bridge with manager and Settings UI. | The transcript fixes make MCP usable from the phone for a day's work; the bridge also unlocks tool approval (P5.5). | No                                  |
| Record pulled-forward extras here instead of phase 4, from now on.                                                                   | Phase 4 stays reliability-only, as its scope line says.                                                             | No                                  |

## Progress

P5.6 is complete in the working tree, not yet committed. `Composer.vue` exposes `focus()` through `defineExpose` (it now also serves the drop and command-picker calls), and `App.vue` adds a window `keydown` listener while a session view is open. A printable key with no meta, ctrl, or alt modifier, and no composition in progress, moves focus to the composer; because the focus happens during the keydown dispatch, the browser routes that same keystroke into the textarea, so the first character is neither lost nor typed twice. Space, Enter, and Backspace are excluded so they keep their role on whatever the reader last tapped, such as activating a run header or a button. If focus is already in an input, textarea, or contenteditable node, or a dialog is open, or no composer is mounted (session list and settings screens), the key stays where it is. The check is `agent-ui.test.ts`: click the heading, `keyboard.type("Typed away")`, and assert the textarea holds exactly that.

P5.1 is complete. Commit `0fcd7dd` (`feat(server): bind codemode, tool_search, and MCP extensions`) builds a `DefaultResourceLoader` per session with the three extension factories and a per-project `SettingsManager`, passes both to `createAgentSession`, and calls `session.bindExtensions({})`, which fires `session_start` and connects MCP servers in the background. `PiSession.close()` emits `session_shutdown` before `dispose()`, which the MCP extension needs to close stdio servers. `/mcp` is filtered from client commands. Tests in `server/test/pi-adapter.test.ts` use a `FauxMcpServer` over `@earendil-works/pi-mcp/testing`'s in-memory transport pair; one runs a codemode script that calls `mcp__faux__ping` end to end and verifies shutdown closes the server. `npm test -w server` passes with 104 tests.

P5.2 is complete. Commit `32563da` (`fix(deploy): put easy-install links on the app service PATH`) adds `Environment=PATH=%h/.local/bin:/usr/local/bin:/usr/bin:/bin` to `deploy/pi-remote.service`, and the deploy change ships `deploy/` so `receive.sh` renders the unit itself. On the host the first wired session reached the model's codemode tool but no MCP tools existed in it. Two host findings closed it: (1) `install-service.sh` had rendered the unit while CI's deploy restart had just spawned the service, and `systemctl start` on an active service is a no-op, so the running process kept the old PATH until a plain restart — it now shows `PATH=/home/<user>/.local/bin:...` in `/proc/<pid>/environ`; (2) the `npx` cache was cold on the first-ever session, so the package download outlasted the model's probe window. An SDK probe with the same wiring then showed 14 `mcp__files__*` tools and `codemode` active at +2 seconds. The host `mcp.json` has the filesystem server, hand written because the `pi` CLI is not installed there.

Two `install-service.sh` fixes came out of the race: units render to temp files and install only when they differ, and a service whose unit changed is restarted (`start` no-ops on an active service), so a manual install after a unit change applies the new environment. Also found pre-existing: `warn_when_deploy_key_drifted`'s bare `return` propagated a failed `[ -n "$line" ]` test as rc 1, failing the whole install on a host with no deploy key yet; it returns 0 now. `deploy/test_install_service.py` runs the script in a sandbox home with stub `systemctl` and asserts fresh install, no-op rerun, and restart-on-change.

P5.3 is half done. `web/src/tools.ts` gains the `NestedToolCall` shape, tool-aware `getToolCommand` rows (codemode script preview, `tool_search` query, MCP argument summaries), `getToolSource` for the full script, and `splitToolName` for `mcp__<server>__<tool>`. `web/src/transcript.ts` records nested calls from live `parentToolCallId` events and merges the durable `nestedCalls` result record, and `settle()` interrupts still-running nested calls. `web/src/components/ToolCard.vue` shows the server prefix, the full name in the row `title`, and up to six nested rows with status icons and durations, gray with red only for failure. Not committed yet at the time; the work landed in `ad58b62` (`feat(web): show MCP and codemode tool calls in the transcript`). `npm run check` and 65 web unit tests pass.

The user then asked, from the phone, to show context usage in the model drawer and to use the bot icon for its button. `PiSession` exposes pi's `getContextUsage()`, the snapshot carries it as `contextUsage`, and `OpenSession` also sends a `context_usage` message when a reply settles or a compaction ends, so the figure moves without a resync. `SessionSettingsPanel` shows `Context: 99K of 1M (10%)` through `formatContextUsage(usage, true)`: the drawer takes compact counts, while the `/session` note keeps exact ones from the same formatter. `SessionSettingsMenu` uses `lucide-bot` instead of `lucide-sliders-horizontal`. The new session-hub test finished the fake run before `hub.prompt` had started it, so the suite hung at that test; it now waits for the run to start, like the older tests do. Committed in `d8f9c52`, `7df537e`, and `0ac5baa`, except the compact counts, which sit in the working tree. `npm run check`, 105 server tests, 65 web unit tests, 2 web integration tests, and the 20-check browser suite pass. The browser run covers the drawer line: `agent-ui.test.ts` carries `contextUsage` in its snapshot and waits for `Context: 42K of 200K (21%)`.

The scroll to bottom button no longer hides behind a run header. `web/src/components/ToolRun.vue` pins its header at `z-10`, and the floating button in `web/src/App.vue` had no z-index, so a header that reached the transcript's bottom edge painted over the button and took the tap. The button is `z-20` now. `web/test/browser/tool-runs.test.ts` gained a trailing text message to the fixture, then scrolls a folded run so its header sits under the button, asserts every point inside the circle hits the button, and asserts the tap returns to the bottom.

The test suites now come in tiers, and the browser suite runs on this host. `test/unit/` holds the logic tests, `test/integration/` holds the ones that bind a socket, spawn the dev proxy, or run real pi sessions, and shared helpers sit in `test/support/`. `npm run test:unit` takes about 6 seconds and `npm run test:integration` about 16; `npm test` still runs both, so CI and the phase done-checks are unchanged. The browser checks failed on this host only because the cached headless shell was missing its system libraries. `web/test/support/browser.ts` now probes Chromium once per file and skips every browser check with one clear line when it cannot start, and installs nothing.

Two things were wrong once the suite could run. The folded-run fixture ran five bash calls back to back with no message between them, so the app correctly made one run of five and the test waited forever for a run of three; a text message now separates the runs. `web/src/components/ThinkingBlock.vue` takes `isOpen`, and `ToolRun.vue` opens the thinking blocks inside an expanded run, which is what the prompt asked for and what the test asserts.

## Handoff

Next step: commit the working tree, which holds only the P5.6 type-to-focus change (`web/src/App.vue`, `web/src/components/Composer.vue`, and the check in `web/test/browser/agent-ui.test.ts`, plus this phase doc). After the commit, start P5.4 with the extension UI bridge. The phone confirmation for P5.1 and P5.2 is in: a fresh session on the host asked to count the project's TypeScript files, pi answered through a codemode script calling the filesystem MCP server, and the transcript card showed the nested call.

Evidence for the committed state: `npm run check` passes, web unit tests pass (65), and the full browser suite passes on this host (20 of 20), so the P5.3 browser condition is met and Chromium's system libraries are in place. `npm run format:check` has the one pre-existing warning in `docs/phases/phase-1-basic-app.md`.

Blockers: this host has no swap. P5.4's manager and OAuth flows need the user's decisions about which MCP servers they actually run on the host.

How to check the current state: `npm run check`, `npm run test:unit` (server 57, web 65), `npm run test:integration` (server 48, web 2), `npm run format:check` (one pre-existing warning in `docs/phases/phase-1-basic-app.md`). Husky needs `export PATH="$HOME/.local/bin:$PATH"` before `git commit`. Deploy-side: pushes render the app unit themselves; `deploy/test_install_service.py` covers the installer. On the host: `tail ~/.pi/agent/mcp.log` after a suspicious session, and a fresh phone session for an end-to-end check (a cold `npx` cache can leave the first minutes tool-less, so prewarm a new server's command by hand once).
