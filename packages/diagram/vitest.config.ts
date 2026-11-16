import { defineProject } from 'vitest/config';

export default defineProject({
  test: { name: 'diagram', include: ['test/**/*.test.ts'], environment: 'node' },
});
