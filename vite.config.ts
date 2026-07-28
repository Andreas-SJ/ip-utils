import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
	const env = loadEnv(mode, '.', '');
	const apiOrigin = env.IP_UTILS_API_ORIGIN || 'http://127.0.0.1:80';

	return {
		plugins: [sveltekit()],
		server: {
			proxy: {
				'/api': {
					target: apiOrigin,
					changeOrigin: true
				}
			}
		}
	};
});
