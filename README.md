# ip-utils Migration Notes

This project is currently being migrated from static HTML pages served by Express to SvelteKit + TypeScript.

## Current Architecture

- Frontend pages: SvelteKit routes in src/routes
- Production page server: SvelteKit Node build mounted by prod-server.mjs
- Backend API/auth/session: Express app in server.cjs mounted under the same Node process
- Shared visual system: skins and icons under public/skins and public/icons

## Local Development (Transition Mode)

1. Start the Express API backend:

```sh
npm run dev:api
```

2. In a second terminal, start the Svelte frontend:

```sh
npm run dev
```

The Vite dev server proxies /api calls to http://127.0.0.1:80 by default.
Override with IP_UTILS_API_ORIGIN if needed.

## Production Runtime

- `npm run build` builds the SvelteKit app with adapter-node
- `npm start` runs `prod-server.mjs`
- `prod-server.mjs` mounts the existing Express API app from `server.cjs`
- SvelteKit serves all page routes and static assets for production requests

## Admin Update Runner Modes

The `/api/admin/update/start` endpoint supports three modes:

- `auto` (default): uses daemon-file mode when updater heartbeat/status files exist, otherwise falls back to installer mode.
- `daemon`: legacy host-daemon file protocol using shared `/app/data` files (`update-request.env`, `update-status.env`, `update-heartbeat`).
- `installer`: runs `installer.sh` inside the app container.
- `daemon-cmd`: runs a configured dispatch command from inside the app container.

Environment variables:

- `IP_UTILS_UPDATE_RUNNER`: `auto`, `daemon`, `installer`, or `daemon-cmd`
- `IP_UTILS_UPDATE_DAEMON_CMD`: command used only in `daemon-cmd` mode
- `IP_UTILS_UPDATE_HEARTBEAT_MAX_AGE_MS`: heartbeat staleness threshold for daemon liveness (default `15000`)

Examples:

```sh
IP_UTILS_UPDATE_RUNNER=daemon
```

```sh
IP_UTILS_UPDATE_RUNNER=daemon-cmd
IP_UTILS_UPDATE_DAEMON_CMD="/usr/local/bin/ip-utils-update-dispatch"
```

## Migrated Routes

- / (Svelte + TypeScript)
- /login (Svelte + TypeScript)
- /admin (Svelte + TypeScript)
- /ip-planner (Svelte route shell + TS runtime module in src/lib/planner/runtime.ts)
- /netplan-gen (Svelte route shell + TS runtime module in src/lib/netplan/runtime.ts)

## Route Handling

- Page routes are served by SvelteKit in production
- API routes remain in Express under `/api`
- Direct requests to unavailable tools redirect to `/tool-not-installed`
- Remaining migration work is focused on moving `/api` endpoints from Express into typed SvelteKit server routes over time

## Build

```sh
npm run build
```
