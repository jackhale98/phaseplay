/**
 * Fingerprint of the demo team's content (plays, drills, roles, kit, match logs, sheets, plans and
 * proposal answers;
 * not dates). When it changes, the next demo start reseeds instead of waiting for the daily
 * refresh. test/demo-version.test.ts fails with the new value whenever demo content changes, so
 * it can't be forgotten.
 */
import type { DemoTables } from './demo';

export const DEMO_CONTENT_VERSION = 'cc0c7984dabfc3694ed2d2e5';

export async function demoContentHash(t: DemoTables): Promise<string> {
  const content = JSON.stringify([
    t.plays.map((p) => [p.title, p.data]),
    t.drills.map((d) => [d.title, d.diagram, d.coaching_points]),
    t.team_roles.map((r) => [r.name, r.permissions]),
    t.inventory_items.map((i) => [i.name, i.quantity, i.holder_member_id]),
    // Season stats content: match logs, sheets and practice plans (no dates).
    t.match_events.map((e) => e.payload),
    t.team_sheets.map((s) => s.slots),
    t.practice_plans.map((p) => [p.title, p.blocks]),
    // Proposals ("Not confirmed yet"): who answered what for each date.
    t.event_options.length,
    t.proposal_answers.map((a) => [a.member_id, a.answer]),
    // "Time TBD" events.
    t.events.filter((e) => e.time_tbd).map((e) => e.title),
  ]);
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content));
  return [...new Uint8Array(hash).slice(0, 12)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
