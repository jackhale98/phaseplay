import { defineProject } from 'vitest/config';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';

const dir = fileURLToPath(new URL('.', import.meta.url));
mkdirSync(`${dir}/../web/build`, { recursive: true });

export default defineProject(async () => {
  const migrations = await readD1Migrations(`${dir}/migrations`);
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: `${dir}/wrangler.toml`, environment: 'test' },
        miniflare: { bindings: { TEST_MIGRATIONS: migrations } },
      }),
    ],
    test: {
      name: 'api',
      include: ['test/**/*.test.ts'],
      setupFiles: ['./test/setup.ts'],
    },
  };
});
