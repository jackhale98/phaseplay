import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: ['packages/shared', 'packages/diagram', 'apps/web', 'apps/api'],
    reporters: process.env.CI ? ['default'] : ['dot'],
  },
});
