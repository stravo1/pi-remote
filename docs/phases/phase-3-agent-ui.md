# Phase 3: A usable agent UI

Status: Done
Last updated: 2026-10-26

## Goal

Make routine tasks usable from a phone. Covers F5 and N3. See [roadmap Phase 3](../roadmap.md#phase-3-a-usable-agent-ui).

## Read first

- `docs/spec.md`: Client views, D2, D4, D7, Wire protocol.
- `docs/pi-events.md`: Tool output, queues, snapshots, thinking levels.
- `docs/phases/phase-2-sessions.md`: Handoff.

## Scope

In scope: Markdown, code highlighting, live tool cards, edit diffs, steer, follow-up, model and thinking pickers, phone layout.
Out of scope: Tool approval, attachments, deployment, Phase 4 reliability work.

## Tasks

- [x] P3.1 Highlight Markdown code safely. Done when: Markdown and injection tests pass.
- [x] P3.2 Show live tool cards and file diffs. Done when: replay and snapshot tests cover output, errors, and diffs.
- [x] P3.3 Send steer and follow-up messages. Done when: SDK and two-client tests cover queues and client tests cover replay.
- [x] P3.4 Add model and thinking pickers. Done when: tests cover valid choices, invalid choices, and shared session state.
- [x] P3.5 Check the phone layout. Done when: isolated headless checks at 375 px show usable controls and wrapped diffs.
- [x] P3.6 Exit check. Done when: the user completes one real task from a phone without a terminal.

## Known facts

- The first designs used a frappe-ui `BottomSheet`, then a `Dialog`. The user rejected both and then the popover. The sheet now follows the user's reference: recent models, an Effort row, and a More models row.
- Passing a configured model to `createAgentSession` overrides the stored session model. Omit that option when reopening saved choices.

## Decisions

| Decision                                                                                                                          | Reason                                                                                                            | Spec changed?      |
| --------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------ |
| Use one settings button in the session bar. It opens a frappe-ui `BottomSheet` with recent models, Effort, and More models views. | The user asked for this layout from a reference screenshot. The recent list lives in `localStorage`, per browser. | Yes: Client views  |
| Use frappe-ui `Combobox` for models. Match the field width and cap the results height.                                            | The user requested search and a compact list. Search matches name, provider, and ID.                              | Yes: Client views  |
| Change model and thinking level only while idle. Broadcast a snapshot after each change.                                          | This prevents changes during a request and keeps devices in sync.                                                 | Yes: Wire protocol |
| Start a prompt when steer or follow-up arrives after a run ends.                                                                  | A browser can send a queued message just as the run settles.                                                      | Yes: Wire protocol |
| Update the pi session name after the conversation changes.                                                                        | The session list stays useful without a polling job. The update does not alter the transcript.                    | Yes: Client views  |

## Progress

P3.1 through P3.6 are complete. The user completed a real task from a phone without a terminal.

- `web/src/markdown.ts` highlights common code languages. Unknown languages remain escaped text. Markdown safety tests pass.
- `web/src/transcript.ts` and `tools.ts` join calls to results by tool ID. They restore output, status, diffs, and queues from snapshots.
- `ToolCard.vue` shows the command, status, wrapped diffs, and collapsible output. Requested write/edit changes have a separate label from actual edit diffs.
- `Composer.vue` accepts follow-up by default during a run. It also offers steer and Stop.
- `SessionSettingsMenu.vue` uses native frappe-ui `BottomSheet` and `TextInput`. The More models view filters by name, provider, or ID.
- `PiSession` validates model and thinking choices and saves them in the session. `SessionHub` sends the changed state to all subscribers.
- `SessionSummaryJob` uses the selected model to update the pi session name. It skips busy sessions and unchanged messages. It also discards stale results.
- The phone settings sheet fits the main menu when it opens. Each submenu keeps that measured height and scrolls its own long content.
- Tool card controls share one vertical center line on phone and desktop.
- `npm test`: 63 server tests and 28 client tests pass. Tests include summary updates, queue delivery, settings persistence, and shared client state.
- `npm run check`: passes. `npm run build`: passes.
- `npm run test:browser -w web`: two checks pass at 375 px and 1280 px. They check model search with 62 choices, matching field/list widths, no page overflow, thinking selection, follow-up, steer, and Stop.
- Browser checks use a separate headless Chromium profile. Screenshots are in `$TMPDIR/pi-remote-phase-3/`.

The local implementation and the phone exit check are complete.

## Handoff

Phase 3 is complete. The user passed the phone exit check. Preserve changes that belong to other agents.
Next step: continue with `phase-4-reliability.md`.
Blockers: none.
How to check the current state: `npm test`, `npm run check`, `npm run build`, `npm run test:browser -w web`.
Install the test browser with `npx playwright install chromium` first.
This session used `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` with the existing isolated Chromium headless shell at revision 1234.
