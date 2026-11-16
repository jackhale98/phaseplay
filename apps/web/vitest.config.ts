import { defineProject } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { fileURLToPath } from 'node:url';

export default defineProject({
  plugins: [svelte({ compilerOptions: { runes: true } })],
  resolve: {
    alias: { '#lib': fileURLToPath(new URL('./src/lib', import.meta.url)) },
    conditions: ['browser'],
  },
  define: { __APP_VERSION__: '"test"', __APP_BUILT_AT__: '"test"' },
  test: { name: 'web', include: ['src/**/*.test.ts'], environment: 'node' },
});
