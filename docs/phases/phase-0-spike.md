# Phase 0: Spike

Status: Done
Last updated: 2026-10-25

## Goal

Learn how pi 1.4.0 behaves through its SDK before the server design depends on it. At the end, `docs/pi-events.md` records the observed event sequences, and the spec reflects anything that turned out different. See [roadmap Phase 0](../roadmap.md#phase-0-spike).

## Read first

- `docs/spec.md`: D1 (SDK in process), D2 (who owns history), D4 (event format), Wire protocol (`snapshot`), Open questions.
- pi docs, installed at `/Users/you/.nvm/versions/node/v24.16.0/lib/node_modules/@earendil-works/pi-coding-agent/docs/`: `sdk.md`, `sessions.md`, `session-format.md`, `message-types.md`.
- pi examples in the same package under `examples/sdk/`: `01-minimal.ts`, `11-sessions.ts`, `13-session-runtime.ts`.

## Scope

In scope: throwaway scripts in `spikes/phase-0/`, the findings doc `docs/pi-events.md`, and spec edits that the findings force.

Out of scope: `server/`, `web/`, the WebSocket protocol code, and anything on EC2.

## Tasks

- [x] P0.1 Create `spikes/phase-0/` as an npm project that pins `@earendil-works/pi-coding-agent` at exactly `1.4.0`. Done when: `npm install` succeeds and a script imports `createAgentSession` without errors.
- [x] P0.2 Select a low-cost OpenRouter model that supports tool calls (see Known facts). Done when: one `session.prompt()` call returns assistant text, and the model ID is recorded in Known facts.
- [x] P0.3 Write an event logger. It subscribes before the prompt and writes every event, unchanged, as one JSON line to `spikes/phase-0/out/<case>.jsonl`. Run a prompt that makes pi call the `bash` tool. Done when: the log has `tool_execution_start`, `tool_execution_end`, `message_end`, and `agent_settled`.
- [x] P0.4 Abort case: call `session.abort()` while a tool runs. Done when: a log exists, and you know which event ends an aborted run.
- [x] P0.5 Steer and follow-up cases: during a run, call `session.steer()` in one log and `session.followUp()` in another. Done when: each log shows the point where the extra message enters.
- [x] P0.6 Session storage: create a session with `SessionManager.create(cwd, dir)`, run one prompt, dispose it, then find it with `SessionManager.list(cwd, dir)` and reopen it with `SessionManager.open(path)`. Done when: the reopened `session.messages` matches the original.
- [x] P0.7 Snapshot check for spec D2: during a run, take `session.messages` plus the events since the last `message_end`. Done when: you can say whether these two pieces rebuild everything a client must show, with the log as evidence.
- [x] P0.8 Fake model: find out if `registerFauxProvider` (exported by `@earendil-works/pi-ai`) can drive `createAgentSession` with scripted replies, including a tool call. Done when: a script runs a scripted tool call with no network, or you record why it cannot.
- [x] P0.9 Write `docs/pi-events.md`. Done when: it gives the observed event order for prompt, tool call, abort, steer, and follow-up (each linked to its log), the result of P0.7, and the answer to spec open question 1. Every claim comes from a log, not from pi's docs.
- [x] P0.10 Update `docs/spec.md` where the findings differ from it. Done when: each change is listed in Decisions, or Decisions says "no spec change".

## Known facts

- pi 1.4.0 is installed globally on the Mac. It requires Node 22.19.0 or later. The Mac has Node 24.16.0 through nvm.
- The package moved from `@mariozechner/pi-coding-agent` to `@earendil-works/pi-coding-agent`. The old name stops at 0.73.1.
- pi rewrote most of its docs between 0.82 and 1.4. Old blog posts and the old package's docs show outdated APIs. Trust the installed docs and the `.d.ts` files.
- The spike uses OpenRouter. Its API key is already in `~/.pi/agent/auth.json`, and the SDK reads that file by default. Never print or copy the key.
- The pi default model is `ollama` / `gemma4:e4b-mlx`, and Ollama was not running on 2026-10-25. Select the OpenRouter model explicitly in the spike scripts, so the default does not apply.
- Session event types in 1.4.0 (from `dist/**/*.d.ts`): `agent_start`, `agent_before_settle`, `agent_end`, `agent_settled`, `turn_start`, `turn_end`, `message_start`, `message_update`, `message_end`, `tool_execution_start`, `tool_execution_update`, `tool_execution_end`, `queue_update`, `compaction_start`, `compaction_end`, `auto_retry_start`, `auto_retry_end`.
- `agent_end` can be followed by retries or queued work. `agent_settled` means pi will not continue on its own.
- `prompt()` resolves only after the whole run. During a run, `prompt()` without `streamingBehavior` rejects. Use `steer()` or `followUp()` instead.
- `SessionManager.create(cwd)` writes to `~/.pi/agent/sessions/`, which holds the user's real sessions. Pass a second argument, `spikes/phase-0/out/sessions`, to keep spike sessions separate.
- SDK sessions do not load the `codemode`, `tool_search`, and MCP extensions that the CLI loads.
- A pi extension can block a tool call from its `tool_call` handler. See `examples/extensions/permission-gate.ts`. This matters for spec D6 later, not for this phase.
- macOS has no `timeout` command. Use a timer inside the script to stop a run.
- Node 24 runs `.ts` files directly (`node p03-tool-call.ts`). The spike needs no `tsx` or build step.
- Spike model: `openrouter` / `deepseek/deepseek-v4-flash`. It supports tool calls and costs about $0.09 per million input tokens. It has only the thinking levels `off`, `high`, and `xhigh`, so pi clamps `low` to `high`.
- `ModelRuntime.create()` writes `{}` to `authPath` when the file is missing. `setRuntimeApiKey()` writes the key into that file. Tests must pass their own `authPath`.
- All event findings are in `docs/pi-events.md`.

## Decisions

| Decision                                                                                                   | Reason                                                                                                     | Spec changed?                           |
| ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| Use OpenRouter for the spike.                                                                              | The user chose it. The key is already set up, and the local model is offline.                              | No                                      |
| Use `deepseek/deepseek-v4-flash` for the spike.                                                            | Low cost, tool calls, and thinking output to observe.                                                      | No                                      |
| The snapshot carries the pending queue (`session.getSteeringMessages()`, `session.getFollowUpMessages()`). | P0.7: the run buffer loses `queue_update` after the next `message_end`.                                    | Yes: D2 text and the `snapshot` fields. |
| Tests use `fauxProvider()` with `ModelRuntime.registerNativeProvider()`.                                   | P0.8: it runs a scripted tool call with no network and no key. `registerFauxProvider` from `compat` fails. | Yes: Testing, open question 1.          |
| Record the size of `message_update` events as a D4 cost and an open question. Do not decide yet.           | Each event repeats the partial message twice. The right fix depends on phone measurements.                 | Yes: D4 costs, open question 5.         |
| No spec change for the `system` message, the overlapping content blocks, or the thinking level clamp.      | These affect client code in Phase 1 and Phase 3, not the design. They are in `docs/pi-events.md`.          | No                                      |

## Progress

All tasks are done. The roadmap exit check passes: `docs/pi-events.md` gives the event order for prompt, tool call, abort, steer, and follow-up.

- P0.1: `spikes/phase-0/package.json` pins `pi-coding-agent` and `pi-ai` at `1.4.0`. `npm install` succeeded.
- P0.2: `p02-prompt.ts` returned text. The model ID is in Known facts.
- P0.3 to P0.8: one script per task in `spikes/phase-0/` (`p03-tool-call.ts` to `p08-faux.ts`). `spike.ts` holds the shared session and logger code. Logs are in `spikes/phase-0/out/`, which git ignores.
- P0.9: `docs/pi-events.md`.
- P0.10: spec edits are listed in Decisions.

The docs and `spikes/phase-0/` are in the first commit on `main`. Nothing is pushed.

## Handoff

Next step: create `docs/phases/phase-1-basic-app.md` from the template, based on roadmap Phase 1.
Blockers: none.
How to check the current state: `cat docs/pi-events.md`. The spike scripts were removed after Phase 4; the findings live in that doc, and `web/test/fixtures/tool-call.jsonl` keeps one distilled log.
