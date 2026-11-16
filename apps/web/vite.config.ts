import { sveltekit } from '@sveltejs/kit/vite';
import adapter from '@sveltejs/adapter-static';
import { defineConfig } from 'vite';

const api = process.env.API_ORIGIN ?? 'http://localhost:8787';

export default defineConfig({
  plugins: [
    sveltekit({
      compilerOptions: { runes: true },
      // SPA with a prerendered landing page. Unknown paths get the 200.html shell from the Worker.
      adapter: adapter({ pages: 'build', assets: 'build', fallback: '200.html', strict: false }),
      csp: {
        mode: 'hash',
        directives: {
          'default-src': ['self'],
          'script-src': ['self'],
          'style-src': ['self', 'unsafe-inline'],
          'img-src': ['self', 'data:', 'blob:'],
          'font-src': ['self'],
          'connect-src': ['self'],
          'worker-src': ['self', 'blob:'],
          'media-src': ['self', 'blob:'],
          'manifest-src': ['self'],
          'object-src': ['none'],
          'base-uri': ['self'],
          'form-action': ['self'],
        },
      },
      serviceWorker: { register: false },
      version: { name: process.env.PUBLIC_VERSION ?? String(Date.now()), pollInterval: 0 },
    }),
  ],
  define: {
    __APP_VERSION__: JSON.stringify(process.env.PUBLIC_VERSION ?? 'dev'),
    __APP_BUILT_AT__: JSON.stringify(new Date().toISOString()),
  },
  server: {
    proxy: { '/api': { target: api }, '/cal': { target: api } },
  },
  preview: {
    proxy: { '/api': { target: api }, '/cal': { target: api } },
  },
  build: { target: 'es2022' },
  worker: { format: 'es' },
});
