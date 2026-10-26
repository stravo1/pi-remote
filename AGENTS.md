# pi remote

A self-hosted web client for the pi coding agent. The design is in `docs/spec.md`. The build order is in `docs/roadmap.md`.

## Phase docs

Work happens in phases. Each phase has one phase doc in `docs/phases/`. It holds the plan, the progress, and the handoff. Several agent sessions work on one phase, one after another. The phase doc is the only memory they share.

1. At session start, open the phase doc with status "In progress". If none is in progress, open the lowest-numbered "Not started" doc. Read its Handoff section first.
2. Work the tasks in order. Tick a task only when its done-check passes.
3. Before you stop, rewrite Progress and Handoff as a current-state snapshot. A new agent with no other context must be able to continue from them.

To start a new phase, copy the template in `docs/phases/README.md`.

## Conventions

- Build all app UI with frappe-ui and follow the Espresso design system.
- Use Espresso-native components, design tokens, typography, spacing, and interaction states. Do not add a separate visual theme.
- Prefer frappe-ui components. Use its tokens and documented patterns for layouts that need custom markup.
- Use gray tokens for all UI. Use color only for errors and warnings, in red. Show state with an icon, not a colored badge. Do not label the normal state, such as "Connected".
- Treat auth screens as part of the same UI requirement. Authelia's stock UI is a separate interface and does not satisfy Espresso compliance.
- Write docs in plain English: short sentences, active voice, no em dashes.
- Pin exact versions of `@earendil-works/pi-coding-agent`.
- Use Conventional Commits: `<type>[optional scope]: <short imperative summary>`.
- Choose the type that fits the change, such as `feat`, `fix`, `docs`, `refactor`, `test`, `build`, or `chore`.
- Example: `feat(server): stream session events over WebSocket`.
- Ask the user before you commit or push.
