/**
 * Fingerprint of the demo team's content (plays, drills, roles; not dates). When it changes, the
 * next demo start reseeds instead of waiting for the daily refresh. test/demo-version.test.ts
 * fails with the new value whenever demo content changes, so it can't be forgotten.
 */
import type { DemoTables } from './demo';

export const DEMO_CONTENT_VERSION = 'b08f200f1b2be6f31b7fd661';

export async function demoContentHash(t: DemoTables): Promise<string> {
  const content = JSON.stringify([
    t.plays.map((p) => [p.title, p.data]),
    t.drills.map((d) => [d.title, d.diagram, d.coaching_points]),
    t.team_roles.map((r) => [r.name, r.permissions]),
  ]);
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content));
  return [...new Uint8Array(hash).slice(0, 12)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
