# pi events

Observed behavior of `@earendil-works/pi-coding-agent` 1.4.0 through the SDK. Every claim here comes from a log in `spikes/phase-0/out/` or from a script in `spikes/phase-0/`. The logs are not in git. Run the script again to make a log.

Model: `openrouter` / `deepseek/deepseek-v4-flash`, thinking level `high`. Run a script with `node <script>.ts` in `spikes/phase-0/`. `python3 summarize.py out/<case>.jsonl` prints a log as one line per event, without deltas.

## Notation

`message_update:<x>` is a `message_update` event with `assistantMessageEvent.type` equal to `<x>`. `message_start:<role>` and `message_end:<role>` show `message.role`. `(deltas)` stands for one or more `*_delta` updates.

## Prompt with a tool call

Script: `p03-tool-call.ts`. Log: `out/tool-call.jsonl`.

```
agent_start
turn_start
  message_start:system, message_end:system
  message_start:user, message_end:user
  message_start:assistant
    message_update:thinking_start, (deltas)
    message_update:toolcall_start, (deltas)
    message_update:thinking_end
    message_update:toolcall_end
  message_end:assistant              stopReason "toolUse"
  tool_execution_start
  tool_execution_update (1 or more)
  tool_execution_end
  message_start:toolResult, message_end:toolResult
turn_end
turn_start
  message_start:assistant
    message_update:thinking_start, (deltas)
    message_update:text_start, (deltas)
    message_update:thinking_end
    message_update:text_end
  message_end:assistant              stopReason "stop"
turn_end
agent_end                            willRetry false
agent_settled                        aborted false
```

Notes:

- Each run starts with a `system` message. It also stays in `session.messages` (see P0.6). Its content is empty, and its prompt text is in `sections`. The client must skip it or show it on purpose.
- The `user` message has no `message_update` events.
- Content blocks can overlap. `thinking_end` came after `toolcall_start` and after `text_start`. The client must place each delta by `contentIndex`, not by arrival order.
- `tool_execution_update.partialResult` holds all output so far, not only the new part. In `out/abort.jsonl`, the text grows from `1\n` to `1\n2\n3\n4\n`. The client can replace the shown output with each update.
- Each `message_update` holds the full partial message twice: in `message` and in `assistantMessageEvent.partial`. Bytes per event grow with message length. `out/snapshot.jsonl` holds 101 events in 176 KB, for replies of about one line.
- Parallel tool calls: both `tool_execution_end` events came before both `toolResult` messages (`out/snapshot.jsonl`).
- No `agent_before_settle`, `auto_retry_*`, or `compaction_*` event occurred in any log.

## Abort

Script: `p04-abort.ts`. Log: `out/abort.jsonl`. The script calls `session.abort()` 3.5 seconds into a 10-second bash command.

```
  tool_execution_update ...          output so far
  tool_execution_end                 isError true, text ends in "Command aborted"
  message_start:toolResult, message_end:toolResult
turn_end
turn_start
  message_start:assistant, message_end:assistant
                                     stopReason "error", errorMessage "This operation was aborted", content []
turn_end
agent_end                            willRetry false
agent_settled                        aborted true
```

- `agent_settled` with `aborted: true` ends an aborted run.
- `session.prompt()` resolves after an abort. It does not reject.
- The empty `error` assistant message stays in `session.messages`.

## Steer

Script: `p05-queue.ts steer`. Log: `out/steer.jsonl`. The script calls `session.steer()` at `tool_execution_start`.

```
  message_end:assistant              stopReason "toolUse"
  tool_execution_start
  queue_update                       steering ["..."], followUp []
  tool_execution_update ...
  tool_execution_end
  message_start:toolResult, message_end:toolResult
turn_end
turn_start
  queue_update                       steering [], followUp []
  message_start:user, message_end:user      the steer text
  message_start:assistant ... message_end:assistant
turn_end
agent_end
agent_settled
```

The steer message enters at the start of the next turn, after the tool results and before the next model call. `steer()` resolves to `"queued"`.

## Follow-up

Script: `p05-queue.ts followUp`. Log: `out/follow-up.jsonl`.

```
  tool_execution_start
  queue_update                       steering [], followUp ["..."]
  ...
  message_end:assistant              stopReason "stop"
turn_end
turn_start
  queue_update                       steering [], followUp []
  message_start:user, message_end:user      the follow-up text
  message_start:assistant ... message_end:assistant
turn_end
agent_end
agent_settled
```

The follow-up enters only after the model stops with no tool call. It starts a new turn inside the same run. There is one `agent_start` and one `agent_settled` for the whole run. `followUp()` resolves to `"queued"`.

## Session storage

Script: `p06-storage.ts`. It writes to `out/sessions/`, not to `~/.pi/agent/sessions/`.

- `SessionManager.list(cwd, dir)` found the session after `dispose()`. It returned `path`, `id`, `cwd`, `created`, `modified`, `messageCount`, and `firstMessage`.
- `SessionManager.open(path, dir)` reopened it. The reopened `session.messages` was deep-equal to the original: `system`, `user`, `assistant`.
- `modified` was 52 ms after `created`, but the reply took seconds. Do not use `modified` as the last-activity time before you check what it records.

## Snapshot check (spec D2)

Script: `p07-snapshot.ts`. Log: `out/snapshot.jsonl`. The run has two parallel tool calls and one follow-up. A listener that subscribes before all others checks three things at each of the 101 events.

| Check                                                                                          | Result                                                                                                                |
| ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `session.messages` equals the messages of all `message_end` events so far                      | True at every event, also inside the `message_end` listener.                                                          |
| Running tools can be found from the events since the last `message_end`                        | True at every event.                                                                                                  |
| Pending steer and follow-up messages can be found from the events since the last `message_end` | False. After `queue_update`, three `message_end` events came before the follow-up entered. The buffer lost the queue. |

Result: `session.messages` plus the events since the last `message_end` rebuild the transcript, the partial assistant message, and running tools. They do not rebuild the queue. The snapshot must also carry `session.getSteeringMessages()` and `session.getFollowUpMessages()`.

## Fake model (spec open question 1)

Script: `p08-faux.ts`. Log: `out/faux.jsonl`.

Yes. pi has a scripted provider that drives `createAgentSession` with no network and no key:

```ts
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";

const faux = fauxProvider();
faux.setResponses([
  fauxAssistantMessage([fauxToolCall("bash", { command: "echo faux" })], { stopReason: "toolUse" }),
  (context) => fauxAssistantMessage(`Saw ${context.messages.at(-1)?.role}.`),
]);
const modelRuntime = await ModelRuntime.create({ authPath: "<temp dir>/auth.json", refreshOnCreate: false });
modelRuntime.registerNativeProvider(faux.provider);
const { session } = await createAgentSession({
  model: faux.getModel(),
  modelRuntime,
  sessionManager: SessionManager.inMemory(cwd),
});
```

- The event order matches the real model, without `thinking_*` updates.
- The scripted tool call runs the real `bash` tool.
- A response can be a function of the context, so a test can check what pi sent.
- `registerFauxProvider` from `@earendil-works/pi-ai/compat` does not work. It registers in a global registry that `ModelRuntime` does not read, and `prompt()` throws "No API key found for faux". `compat` is also marked for removal.
- `ModelRuntime.create()` writes `{}` to `authPath` if the file is missing. `setRuntimeApiKey()` writes the key to that file. Give tests their own `authPath`.

## Thinking level

The session clamps the thinking level to the levels the model supports. `deepseek/deepseek-v4-flash` supports only `off`, `high`, and `xhigh` (`model.thinkingLevelMap`), so `low` became `high`. A thinking level picker must offer only the levels in `thinkingLevelMap` that are not `null`.
