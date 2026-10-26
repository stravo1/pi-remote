# pi remote

A web client for the [pi coding agent](https://pi.dev). The server runs pi on one machine. You open the client in a browser on any of your devices and work with the same sessions.

The stack is self-hosted on one rented machine. Caddy serves HTTPS on your domain, and Authelia asks for a password and a second factor before any request reaches the server.

## Status

Phase 0 (spike) and the original Phase 1 checklist are done.
The findings are in [pi events](docs/pi-events.md).
The deployed app runs behind Caddy and Authelia. The user confirmed authenticated chat from a phone.
The latest Espresso app UI is local only. The stock auth portal still needs an Espresso frontend plan.

## Local setup

Use Node 22.19 or later. Run these commands from the repository root:

```sh
npm install
cp config.example.json config.local.json
```

Set `projects[0]` in `config.local.json` to your project's absolute path.
The example selects the OpenRouter model from the spike.
Add its credentials through pi before you start the server.
You can also select another model or omit `model` to use pi's settings.
The server does not send credentials to the browser.

For development, start the backend with automatic restart in one terminal:

```sh
npm run dev -w server -- "$PWD/config.local.json"
```

In a second terminal, start Vite with Vue hot reload:

```sh
npm run dev -w web -- "$PWD/config.local.json"
```

Open the `origin` from your local configuration. The example uses `http://127.0.0.1:8080`.
Vite reads the same configuration and proxies `/api` and `/ws` to the backend.
It adds the configured user header for local WebSocket connections. No Caddy or Authelia is needed for development.
The development server listens only on loopback.
Both commands take the same configuration path. Restart them after changing that file.
Changes to Vue components and styles reload through Vite without a frontend build.

Verify changes with:

```sh
npm test
npm run check
npm run build
```

Run the isolated browser checks with:

```sh
npx playwright install chromium
npm run test:browser -w web
```

These checks use headless Chromium with a temporary profile at 375 px and 1280 px.
They cover tool diffs, the model sheet, thinking levels, follow-up, steer, and Stop.
Screenshots go to `pi-remote-phase-3` inside the system temporary directory.
If Chromium is already installed elsewhere, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to that test browser's executable.

To test the production build locally, start the backend without watch mode:

```sh
npm start -- "$PWD/config.local.json"
```

In a second terminal, start [Caddy](https://caddyserver.com/docs/install):

```sh
caddy run --config dev/Caddyfile --adapter caddyfile
```

Open `http://127.0.0.1:8080` in your browser.
The [local proxy configuration](dev/Caddyfile) replaces `Remote-User` with `me`.
It listens on loopback and has no login. Use it for local development only.
The server checks the WebSocket origin and user header.
Direct browser connections to port 7710 fail because browsers cannot set that header.

The first page lists sessions by project. Pick one to open it in a full-width chat page. A new session runs in the project you pick, and the client reconnects after a network drop.
The server logs each run's event count and JSON payload bytes sent across all connected clients.
The byte count excludes WebSocket framing and proxy overhead.

The client follows frappe-ui's [standalone setup](https://ui.frappe.io/docs/getting-started/standalone).

## Documents

- [Specification](docs/spec.md): what the system does, how the parts fit, and the design decisions.
- [Roadmap](docs/roadmap.md): the build order, in phases. Each phase ends with something you can use.
- [System requirements](docs/system-requirements.md): what the host machine and the client devices need.
- [Deployment](docs/deployment.md): the host setup, login configuration, and proxy templates.
- [Phase docs](docs/phases/README.md): the plan, progress, and handoff for each phase. Agents start here.

## Layout

```
pi-remote/
  server/   Node + TypeScript. Owns the pi sessions.
  web/      Vue 3 + frappe-ui. The browser client.
  docs/
```

`server` and `web` are npm workspaces in one repository.
