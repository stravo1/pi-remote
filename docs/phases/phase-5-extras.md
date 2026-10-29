# Phase 5: Extras

Status: In progress
Last updated: 2026-10-28

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
- [ ] P5.3 MCP transcript UI. Done when: the browser suite passes on the Mac for the folded-run and card paths alongside the new unit tests. Unit tests pass on Linux; the browser run is owed.
- [ ] P5.4 MCP settings and management UI. Done when: a Settings section lists servers with state, the extension UI bridge shows MCP errors as visible messages, and OAuth sign-in accepts a pasted redirect URL.
- [ ] P5.5 Tool approval (D6). Done when: a gate extension blocks risky calls and the client shows the confirm dialog.
- [ ] P5.6 A file browser for the project.
- [ ] P5.7 A terminal tab (xterm.js).

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

P5.1 is complete. Commit `0fcd7dd` (`feat(server): bind codemode, tool_search, and MCP extensions`) builds a `DefaultResourceLoader` per session with the three extension factories and a per-project `SettingsManager`, passes both to `createAgentSession`, and calls `session.bindExtensions({})`, which fires `session_start` and connects MCP servers in the background. `PiSession.close()` emits `session_shutdown` before `dispose()`, which the MCP extension needs to close stdio servers. `/mcp` is filtered from client commands. Tests in `server/test/pi-adapter.test.ts` use a `FauxMcpServer` over `@earendil-works/pi-mcp/testing`'s in-memory transport pair; one runs a codemode script that calls `mcp__faux__ping` end to end and verifies shutdown closes the server. `npm test -w server` passes with 104 tests.

P5.2 is complete. Commit `32563da` (`fix(deploy): put easy-install links on the app service PATH`) adds `Environment=PATH=%h/.local/bin:/usr/local/bin:/usr/bin:/bin` to `deploy/pi-remote.service` and asserts it in `deploy/test_service_setup.py`. The installed unit still needs a host-side `bash deploy/install-service.sh`, owed from the push; the phone-side prompt check is the real PATH verification, because `pi mcp list` runs in the login shell that already has the PATH.

P5.3 is half done. `web/src/tools.ts` gains the `NestedToolCall` shape, tool-aware `getToolCommand` rows (codemode script preview, `tool_search` query, MCP argument summaries), `getToolSource` for the full script, and `splitToolName` for `mcp__<server>__<tool>`. `web/src/transcript.ts` records nested calls from live `parentToolCallId` events and merges the durable `nestedCalls` result record, and `settle()` interrupts still-running nested calls. `web/src/components/ToolCard.vue` shows the server prefix, the full name in the row `title`, and up to six nested rows with status icons and durations, gray with red only for failure. Not committed yet: the changes sit in the working tree (`web/src/tools.ts`, `web/src/transcript.ts`, `web/src/components/ToolCard.vue`, their tests, and this doc). `npm run check` and 65 web unit tests pass.

## Handoff

Next step: commit the P5.3 working-tree changes (`feat(web): show MCP and codemode tool calls in the transcript`), then run the browser suite on the Mac (`npm run test:browser -w web`) to close P5.3, then start P5.4 with the extension UI bridge.

Blockers: the browser suite needs the Mac. P5.4's manager and OAuth flows need the user's decisions about which MCP servers they actually run on the host.

How to check the current state: `npm run check`, `npm test` (server 104, web 65), `npm run format:check` (one pre-existing warning in `docs/phases/phase-1-basic-app.md`). Husky needs `export PATH="$HOME/.local/bin:$PATH"` before `git commit` on this Mac. On the host: `pi mcp list` for server health, and the phone prompt check for the service PATH.
