import { describe, expect, it } from 'vitest';
import { buildDemo } from '../src/seed/demo';
import { DEMO_CONTENT_VERSION, demoContentHash } from '../src/seed/demo-version';

describe('demo content version', () => {
  it('matches the demo content (update DEMO_CONTENT_VERSION when demo plays or drills change)', async () => {
    expect(DEMO_CONTENT_VERSION).toBe(await demoContentHash(buildDemo(0)));
  });
});
