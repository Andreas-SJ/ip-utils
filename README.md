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
