# ip-utils Migration Notes

This project is currently being migrated from static HTML pages served by Express to SvelteKit + TypeScript.

## Current Architecture

- Frontend pages: SvelteKit routes in src/routes
- Backend API/auth/session: Express server in server.cjs
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

## Migrated Routes

- / (Svelte + TypeScript)
- /login (Svelte + TypeScript)
- /admin (Svelte + TypeScript)
- /ip-planner (Svelte route shell + TS runtime module in src/lib/planner/runtime.ts)
- /netplan-gen (Svelte route shell + TS runtime module in src/lib/netplan/runtime.ts)

## Temporary Legacy Route Fallbacks

No route-level fallbacks remain. Remaining migration work is incrementally removing ts-nocheck and replacing legacy DOM/runtime sections with fully typed Svelte/TS components.

## Build

```sh
npm run build
```
