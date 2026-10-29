# Specification

## Goal

One person runs pi on one machine and uses it from any device through a browser. A session continues on the server when a browser tab closes. Any device can open the same session and see its live state.

## Non-goals

- More than one human user. One Authelia account controls access.
- Agents other than pi. The design keeps this possible, but no work goes into it.
- Sandboxing. pi has no built-in sandbox, and this project does not add one. See [Security](#security).
- Third-party access services such as Tailscale or Cloudflare. The machine is rented, and the project owns the rest of the stack.

## Terms

| Term        | Meaning                                                                     |
| ----------- | --------------------------------------------------------------------------- |
| Host        | The rented machine that runs Caddy, Authelia, the server, and pi.           |
| Proxy       | Caddy. It serves HTTPS on your domain and asks Authelia about each request. |
| Auth server | Authelia. It shows the login page and decides if a request is logged in.    |
| Server      | The Node process in `server/`. It owns all pi sessions.                     |
| Client      | One browser tab that runs the app in `web/`.                                |
| Session     | One pi conversation, stored by pi as a JSONL file.                          |
| Run         | The work pi does after one prompt, until pi emits `agent_settled`.          |
| Project     | A directory on the host that pi works in (the session `cwd`).               |

## Use cases

1. Start a session in a project from a laptop. Give pi a task.
2. Close the laptop. Open the same session on a phone. See the run continue live.
3. While pi works, add a message. Choose to steer the current run or queue a follow-up.
4. Stop a run that goes wrong.
5. Open an old session and continue it.

## Architecture

```
 phone / laptop / tablet                         host (public IP)
+----------------------+    HTTPS      +---------------------------------+
| Client (Vue app)     | <-----------> | Caddy :443                      |
|  WebSocket client    |  (internet)   |   forward_auth -> Authelia      |
+----------------------+               |                   127.0.0.1:9091|
                                       |   reverse_proxy -> 127.0.0.1:   |
                                       |                    <port>       |
                                       |                                 |
                                       | Server (Node)                   |
                                       |   Transport   (HTTP + WebSocket)|
                                       |   SessionHub  (open sessions,   |
                                       |                viewers, buffer) |
                                       |   PiAdapter   (pi SDK calls)    |
                                       |        |                        |
                                       |   pi SDK (in process)           |
                                       |   ~/.pi/agent/sessions/*.jsonl  |
                                       +---------------------------------+
```

### Server modules

- `PiAdapter` is the only module that imports pi. It opens, lists, creates, and disposes sessions, and it forwards commands (`prompt`, `steer`, `followUp`, `abort`). A change in pi's API touches this module only.
- `SessionHub` keeps one entry per open session: the pi session, the set of subscribed clients, and the event buffer for the active run. It sends each pi event to every subscribed client.
- `Transport` serves the built client files and the WebSocket endpoint. It parses client messages and calls `SessionHub`.

### Client views

- Session list: sessions grouped by project. Order follows the chat where the user last sent a message. That project comes first on desktop and last on a phone, so on a phone that chat sits at the bottom, next to the header. Each project lists its most recent user message first on desktop and last on a phone. A running reply does not move a chat. A project shows its first three sessions and then a button for the full project session page. The full page lists every session in that project and has a back button. A button starts a new session in a project. A project keeps at most one session with no messages. Pressing the button again reuses that empty session. When its first run starts, the next press starts a new session. The list is a full page. Picking a session opens the chat page, with a back button to the list. Both pages have a maximum width on desktop.
- Session names: after the first response, the idle session makes an initial title from its last six user and assistant messages. A short delay combines changes without polling. The server then checks the conversation periodically. The selected model keeps the title unless the session has moved to a substantially different task or project. Only then does it return a replacement title of three to eight words. The server discards a result if the conversation changes during the request.
- Session view: the transcript, live output, tool calls, and an input box. Three or more tool calls in a row fold into one row that says "Ran N commands" and expands on tap. A shorter run shows each card. While a run is active, the input box sends a follow-up by default and offers "steer" as a second action. A stop button aborts the run.
- Session settings: a settings button beside the send button opens a native frappe-ui bottom sheet on a phone and a popover on desktop. Both show the same content. The sheet lists the current and the most recently used models (up to four, saved in the browser), an Effort row, and a More models row with search.
  The model list matches the field width and scrolls within a fixed height limit.
  Only models with configured access and supported thinking levels appear. Settings changes require an idle session.
  Choices apply to that session and survive reopening it. They do not change the global defaults.

## Functional requirements

| ID  | Requirement                                                                                                                                  |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | The client lists sessions for each configured project.                                                                                       |
| F2  | The client starts a new session in a configured project. A project has at most one session with no messages, and a repeated start reuses it. |
| F3  | The client opens a session and shows its full transcript.                                                                                    |
| F4  | The client streams assistant text, thinking, and tool calls as pi emits them.                                                                |
| F5  | The client sends a prompt. During a run, it sends a steer or a follow-up.                                                                    |
| F6  | The client aborts the active run.                                                                                                            |
| F7  | A run continues when all clients disconnect.                                                                                                 |
| F8  | A client that connects during a run sees the run state, then live events.                                                                    |
| F9  | Two clients on one session see the same events. Input from either one goes to the session.                                                   |
| F10 | The server only starts sessions in projects created under `projectsRoot`.                                                                    |
| F11 | The client creates a project: a new folder directly inside `projectsRoot`.                                                                   |

## Non-functional requirements

| ID  | Requirement                                                                                                         |
| --- | ------------------------------------------------------------------------------------------------------------------- |
| N1  | The server listens on `127.0.0.1` only. Remote access goes through Caddy, after Authelia accepts the request.       |
| N2  | The server restarts after a crash or a host reboot (systemd).                                                       |
| N3  | The client works on a phone screen 375 px wide.                                                                     |
| N4  | A reconnect after a network drop needs no user action.                                                              |
| N5  | The server pins an exact pi version. An upgrade is a deliberate change.                                             |
| N6  | The server sends a WebSocket ping every 30 seconds, so proxies and mobile networks do not close a quiet connection. |
| N7  | The host accepts inbound traffic on ports 80 and 443 only. SSH is limited to your IP address or closed.             |

## Design decisions

Each table lists the options, the recommendation, and what the recommendation gives up.

### D1. How the server talks to pi

| Option                                       | Gains                                                      | Costs                                                                                                                                       |
| -------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| SDK in process (`createAgentSession`)        | Typed events and commands. No parsing. One process to run. | A crash in pi stops all sessions. The server must use Node 22.19 or later.                                                                  |
| RPC subprocess per session (`pi --mode rpc`) | Crash isolation per session. Any language can drive it.    | JSON over stdin and stdout. More code to manage processes. Each process needs about 130 MB, which a 1 GB host cannot give to many sessions. |
| JSON print mode (`pi --mode json`)           | Simplest to call.                                          | One prompt per process. No steering, no abort, no long-lived session.                                                                       |

Recommendation: the SDK in process, behind `PiAdapter`. A second session in the same process adds about 5 MB, which suits a small host. It gives up crash isolation. `PiAdapter` keeps a later move to RPC small.

Note: SDK sessions do not load the `codemode`, `tool_search`, and MCP extensions that the CLI loads. If you need MCP, add those extension factories in `PiAdapter`.

### D2. Who owns the session history

| Option                                                        | Gains                                            | Costs                                                                 |
| ------------------------------------------------------------- | ------------------------------------------------ | --------------------------------------------------------------------- |
| pi's session file, plus an in-memory buffer of the active run | One owner for history. No second store to drift. | Partial output of a run is lost if the server crashes.                |
| A separate append-only event log per session                  | Exact replay of every event, also after a crash. | A second copy of history that can disagree with pi's file. More disk. |
| Memory only                                                   | Least code.                                      | Clients cannot see history after a server restart.                    |

Recommendation: pi's session file plus the run buffer. pi writes finished messages (`message_end`) to its file. The server keeps the events since the last `message_end` of the active run. On subscribe, the client gets `session.messages`, the pending steer and follow-up messages, and then the buffer. The buffer alone loses the queue, because a `queue_update` can come several `message_end` events before the message enters (see [pi events](pi-events.md#snapshot-check-spec-d2)). This gives up crash recovery of a partial assistant message.

### D3. Transport

| Option                            | Gains                                   | Costs                          |
| --------------------------------- | --------------------------------------- | ------------------------------ |
| WebSocket                         | One connection for events and commands. | Reconnect logic in the client. |
| Server-sent events plus HTTP POST | Browser reconnects SSE by itself.       | Two channels to keep in order. |

Recommendation: WebSocket. Commands and events share one ordered channel. It gives up the browser's built-in SSE reconnect, so the client must write its own.

### D4. Event format on the wire

| Option                                  | Gains                                                          | Costs                                                                                                                                                                           |
| --------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pass pi events through in an envelope   | No mapping code. The client can import pi's event types.       | The client depends on pi's event shapes. A pi change can break the UI. Each `message_update` holds the full partial message twice, so bytes per event grow with message length. |
| Own event schema, mapped in `PiAdapter` | The client does not know about pi. A second agent is possible. | Mapping code for every event type.                                                                                                                                              |

Recommendation: pass pi events through for now. It gives up independence from pi. Revisit this if a second agent becomes a goal.

### D5. Network access and login

| Option                                   | Gains                                                                                                                  | Costs                                                                                                                 |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Caddy with Authelia in front             | Self-hosted. Password plus a second factor (TOTP or passkey). Lockout after failed logins. No auth code in the server. | Ports 80 and 443 are open to the internet. Two more services to configure and patch.                                  |
| Caddy with a login built into the server | Self-hosted. One service fewer.                                                                                        | You write and maintain password hashing, 2FA, rate limits, and session cookies. A bug in that code exposes the shell. |
| Caddy with basic auth                    | Minutes of setup.                                                                                                      | No second factor and no lockout. The browser sends the password with every request.                                   |
| Tailscale                                | No open ports.                                                                                                         | Each device needs the app. Depends on a third-party coordination service.                                             |
| Cloudflare Tunnel with Cloudflare Access | No open ports. Login in any browser.                                                                                   | Depends on Cloudflare, which sees all traffic.                                                                        |

Recommendation: Caddy with Authelia. The project depends only on the rented machine, the domain registrar, and the certificate authority (Let's Encrypt). It gives up the protection of a closed network. Caddy and Authelia face the internet, so they must stay patched.

The host needs a public IPv4 address. An Elastic IP is optional and keeps the address stable.
A normal EC2 public IPv4 changes after a stop/start. Update both DNS records when it changes.
A reboot keeps the address. See [AWS instance lifecycle](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ec2-instance-lifecycle.html).

### D6. Tool approval

pi runs every tool call without asking. A pi extension can block a call from its `tool_call` handler (see pi's `permission-gate.ts` example). The SDK lets the host supply the UI for an extension's `confirm` dialog through `session.bindExtensions({ uiContext })`.

| Option                                                     | Gains                                       | Costs                                                          |
| ---------------------------------------------------------- | ------------------------------------------- | -------------------------------------------------------------- |
| No approval, the same as pi in a terminal                  | No code.                                    | A bad command runs while you are away.                         |
| An approval extension, with the dialog shown in the client | You approve risky commands from your phone. | A run waits until a client answers. More protocol.             |
| Run pi in a container or VM                                | Real isolation.                             | Setup work. Toolchains and credentials must be inside the box. |

Recommendation: no approval through Phase 3. Add the approval extension in Phase 5. This accepts the same risk as pi in a terminal until then.

### D7. Frontend stack

| Option                          | Gains                                                                            | Costs                                                                                                |
| ------------------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Vue 3 with frappe-ui            | Known stack. Espresso look. About 70 KB gzipped for a typical set of components. | Installs heavy dependencies on disk (TipTap, ECharts). They do not reach the bundle unless imported. |
| Vue 3 with reka-ui and Tailwind | Smaller install.                                                                 | You style every component.                                                                           |
| React with shadcn/ui            | Large community.                                                                 | A second framework to learn and keep.                                                                |

Recommendation: Vue 3 with frappe-ui. Use its components and Espresso design tokens for typography, colors, spacing, and interaction states.
Use the same tokens for layouts that need custom markup. Do not add a separate visual theme.
Authentication screens have the same Espresso requirement. Authelia's stock portal is an interim interface and does not meet it.
Write the WebSocket client yourself, because frappe-ui's data helpers expect a Frappe backend.

## Wire protocol

All messages are JSON over one WebSocket at `/ws`. Every message has a `type`.

Client to server:

| type                    | Fields                             | Effect                                                                                                       |
| ----------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `list_sessions`         |                                    | Server replies with `sessions`.                                                                              |
| `new_group`             | `name`                             | Creates the folder `<projectsRoot>/<name>` and lists it as a project. Server replies with `group_created`.   |
| `new_session`           | `project`                          | Returns the project's empty session, or creates one when it has none. Server replies with `session_created`. |
| `subscribe`             | `sessionId`                        | Opens the session if needed. Server replies with `snapshot`, then sends `event` messages.                    |
| `unsubscribe`           | `sessionId`                        | Stops events for this client.                                                                                |
| `prompt`                | `sessionId`, `text`                | Starts a run. Rejected during a run.                                                                         |
| `steer`                 | `sessionId`, `text`                | Adds a message after the current turn. Starts a prompt if the run has ended.                                 |
| `follow_up`             | `sessionId`, `text`                | Adds a message after the current run. Starts a prompt if the run has ended.                                  |
| `abort`                 | `sessionId`                        | Stops the active run.                                                                                        |
| `set_model`             | `sessionId`, `provider`, `modelId` | Selects an available model while idle. Sends a fresh snapshot to all subscribers.                            |
| `set_thinking_level`    | `sessionId`, `level`               | Selects a supported thinking level while idle. Sends a fresh snapshot to all subscribers.                    |
| `list_providers`        |                                    | Lists AI-provider authentication status. It never includes credentials.                                      |
| `get_default_model`     |                                    | Lists the models of the active providers and the stored default model.                                       |
| `set_default_model`     | `provider`, `modelId`              | Stores the default model for new sessions. Empty `provider` and `modelId` reset it to automatic.             |
| `set_provider_key`      | `provider`, `apiKey`               | Stores an API key for a provider on the host.                                                                |
| `start_provider_login`  | `provider`, `authType`             | Starts a provider API-key or OAuth login.                                                                    |
| `submit_provider_login` | `loginId`, `value`                 | Answers the current provider login prompt.                                                                   |
| `cancel_provider_login` | `loginId`                          | Cancels a pending provider login.                                                                            |
| `logout_provider`       | `provider`                         | Removes the saved credential for a provider.                                                                 |

Server to client:

| type                     | Fields                                                                                                                      | Meaning                                                                                                                                         |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `sessions`               | `projects: [{ path, sessions: [{ id, name, firstMessage, modified, lastUserMessage, isRunning }] }]`, optional `groupsRoot` | Session list. `lastUserMessage` is absent when the user has not sent a message. `groupsRoot` is present only when the client can create groups. |
| `group_created`          | `project`                                                                                                                   | The new group is ready.                                                                                                                         |
| `session_created`        | `sessionId`                                                                                                                 | The new or reused empty session is ready.                                                                                                       |
| `snapshot`               | `sessionId`, `messages`, `isStreaming`, `queue: { steering, followUp }`, `runEvents`, `seq`, `settings`                     | Full state at subscribe time or after a settings change.                                                                                        |
| `event`                  | `sessionId`, `seq`, `event`                                                                                                 | One pi event, unchanged.                                                                                                                        |
| `error`                  | `message`, optional `sessionId`                                                                                             | A command failed.                                                                                                                               |
| `providers`              | `providers: [{ id, name, authTypes, isConfigured, source? }]`                                                               | AI-provider status without credentials.                                                                                                         |
| `default_model`          | `models`, optional `model`                                                                                                  | Models of the active providers, plus the stored default model when it is still available.                                                       |
| `provider_login_started` | `loginId`                                                                                                                   | A provider login is ready for browser interaction.                                                                                              |
| `provider_login_event`   | `loginId`, `event`                                                                                                          | A provider URL, device code, progress notice, or input prompt.                                                                                  |

`settings` contains `model`, `models`, `thinkingLevel`, and `thinkingLevels`.
Each model contains only `provider`, `id`, and `name`. The server never sends credentials.
The thinking levels come from the selected model's SDK capabilities.

Provider settings are global to the host's pi auth store. The browser can submit a key or answer a provider prompt over the authenticated WebSocket, but the server never returns either the submitted value or a saved credential.

The settings screen also holds a Default model section. It shows one row for the model that new sessions start with. The picker lists an Automatic entry and the models of the active providers. Automatic means pi picks a model from the active providers. A stored default model disappears from the pick when its provider is removed, and signing out of that provider clears the stored choice, so new sessions pick automatically again. Each open session keeps its own model.

`seq` increases by one for each event in a session. A client that sees a gap sends `subscribe` again and gets a new snapshot.

## Session lifetime on the server

1. `subscribe` opens the session with `SessionManager.open(path)` if it is not open.
2. The session stays open while a run is active or a client is subscribed.
3. When neither is true for `idleMinutes`, the server calls `session.dispose()`.
4. On shutdown, the server aborts active runs and disposes all sessions.

## Configuration

The server reads one JSON file. There are no hidden defaults for paths.
The configuration path comes from the command line: `npm start -- /absolute/path/to/config.json`.

```json
{
  "host": "127.0.0.1",
  "port": 7710,
  "origin": "https://pi.example.com",
  "allowedUser": "me",
  "projectsRoot": "/home/ubuntu/code",
  "idleMinutes": 30
}
```

The default model for new sessions is the one stored in pi's settings, chosen in the app's Settings screen.
When it is unset, or its provider has no active login, pi picks a model from the active providers. Existing sessions restore their saved model.
Credentials stay in pi's auth file or the provider environment.
`projectsRoot` is an absolute path that holds every project. The client creates projects directly inside it.
A project name is one path segment of letters, numbers, dots, dashes, or underscores. It cannot start with a dot or dash.
The server keeps the project list in `<projectsRoot>/.pi-remote/projects.json`.
The server opens no session at start. Each session runs in the project the client picked.
Every command that targets a session names it with `sessionId`.

## Security

- The server is a remote shell on the host. Anyone who passes the login can run commands as the host user.
- The server binds to `127.0.0.1`. Only Caddy forwards traffic to it.
- Authelia requires a password and a second factor (TOTP or a passkey) for the app domain. Its regulation setting locks the account after repeated failed logins.
- Caddy deletes any `Remote-User` header from the client request before `forward_auth`. Caddy then copies `Remote-User` from Authelia's answer. The server rejects requests where `Remote-User` is not `allowedUser`.
- The server rejects a WebSocket upgrade when the `Origin` header is not the configured `origin`. Without this check, another website could open a socket with your login cookie.
- The host installs OS security updates automatically. Caddy and Authelia get updates when they publish security releases.
- pi project trust only controls which project files pi loads. It is not a sandbox.
- Credentials stay in `~/.pi/agent` and in Authelia's configuration. The server never sends them to a client.

## Failure handling

| Failure                                      | Behavior                                                                                                                                                   |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Client loses the network                     | The client reconnects with backoff, then subscribes again. The run continues on the server.                                                                |
| pi throws during a run                       | The server sends `error` and keeps the session open.                                                                                                       |
| Server crashes                               | The service manager restarts it. Finished messages are in pi's file. The partial message of the active run is lost.                                        |
| Project path is not in the configuration     | The server rejects `new_session` with `error`.                                                                                                             |
| The login session expires                    | The WebSocket upgrade fails. The client requests `/api/ping`. On a redirect, 401, or 403, it reloads the page, and the browser goes to the Authelia login. |
| A proxy or network closes a quiet connection | The ping in N6 prevents most of these. The client reconnects on any close.                                                                                 |

## Testing

- `PiAdapter`: tests against a real pi session with `SessionManager.inMemory()` and pi's scripted provider (`fauxProvider` from `@earendil-works/pi-ai/providers/faux`). No network and no key. See [pi events](pi-events.md#fake-model-spec-open-question-1).
- `SessionHub`: unit tests for fan-out to many clients, the run buffer, `seq`, and idle disposal.
- Protocol: an integration test that connects two WebSocket clients to one session.
- Client: component tests for the session view with recorded event streams.

## Open questions

1. Answered: pi has a scripted provider. See [pi events](pi-events.md#fake-model-spec-open-question-1).
2. Must the transcript show thinking blocks, or hide them by default?
3. How large can `snapshot` get for a long session? If it is too large, page the messages.
4. Which model access does the host use: Sign in with ChatGPT (`/login openai`), an OpenRouter key, or another API key? A Claude subscription does not work with pi, because Anthropic limits subscription logins to its own apps.
5. Must the server cut `message_update` events before it sends them? Each one repeats the full partial message twice. Options: send them unchanged, drop `message` and `partial` and let the client build the message from deltas, or send only the latest update at a set interval. Measure on a phone in Phase 1 or 3.
