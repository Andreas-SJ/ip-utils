import { createRequire } from 'node:module';

process.env.IP_UTILS_DISABLE_LEGACY_PAGE_ROUTES = '1';

const require = createRequire(import.meta.url);
const { app, bootstrap } = require('./server.cjs');

let handler;
try {
	({ handler } = await import('./build/handler.js'));
} catch (error) {
	console.error('Missing Svelte build output. Run "npm run build" before starting the production server.');
	console.error(error);
	process.exit(1);
}

app.use(handler);

bootstrap(app).catch((error) => {
	console.error('Fatal error during bootstrap:', error);
	process.exit(1);
});
