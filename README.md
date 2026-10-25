# pi web

A web client for the [pi coding agent](https://pi.dev). The server runs pi on one machine. You open the client in a browser on any of your devices and work with the same sessions.

The stack is self-hosted on one rented machine. Caddy serves HTTPS on your domain, and Authelia asks for a password and a second factor before any request reaches the server.

## Status

Phase 0 (spike) is done. The findings are in [pi events](docs/pi-events.md). No app code yet.

## Documents

- [Specification](docs/spec.md): what the system does, how the parts fit, and the design decisions.
- [Roadmap](docs/roadmap.md): the build order, in phases. Each phase ends with something you can use.
- [System requirements](docs/system-requirements.md): what the host machine and the client devices need.
- [Phase docs](docs/phases/README.md): the plan, progress, and handoff for each phase. Agents start here.

## Planned layout

```
pi-web/
  server/   Node + TypeScript. Owns the pi sessions.
  web/      Vue 3 + frappe-ui. The browser client.
  docs/
```

`server` and `web` are npm workspaces in one repository.
