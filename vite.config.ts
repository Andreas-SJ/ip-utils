import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

const apiOrigin = process.env.IP_UTILS_API_ORIGIN || 'http://127.0.0.1:80';

export default defineConfig({
	plugins: [sveltekit()],
	server: {
		proxy: {
			'/api': {
				target: apiOrigin,
				changeOrigin: true
			}
		}
	}
});
