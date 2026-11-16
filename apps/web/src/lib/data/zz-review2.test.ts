import 'fake-indexeddb/auto';
import { describe, it, vi } from 'vitest';

vi.mock('#lib/api', async () => {
  const real = await vi.importActual<any>('#lib/api');
  return {
    ...real,
    v1: (p: string) => `/api/v1${p}`,
    api: vi.fn(async (path: string) => {
      if (path.endsWith('/me')) return { user: { id: 'userB' }, memberships: [{ team: { id: 't1', name: 'T' }, member: { id: 'mB', role: 'player' } }], demo: false };
      if (path.includes('/sync')) {
        console.log('SYNC PATH', path);
        return { cursor: Date.now(), full: false, team: { id: 't1', name: 'T', colors: null }, me: { id: 'mB', role: 'player' },
          members: [], seasons: [], events: [], rsvps: [], rsvpCounts: {}, sheets: [], plays: [], drills: [], plans: [] };
      }
      return {};
    }),
  };
});
vi.mock('#lib/stores/toast.svelte', () => ({ toasts: { show() {}, error() {}, undo() {} } }));
vi.mock('#lib/stores/theme.svelte', () => ({ theme: { init() {}, applyTeam() {} } }));

describe('review2', () => {
  it('signing in as B on fresh /signin load reuses A coach snapshot', async () => {
    vi.stubGlobal('navigator', { onLine: true });
    vi.stubGlobal('localStorage', { setItem() {}, removeItem() {} });
    const { saveSnapshot, kv } = await import('./idb');
    await kv.set('me', { user: { id: 'userA' } });
    await saveSnapshot({ teamId: 't1', cursor: 123, syncedAt: 1, team: { id: 't1' } as any, me: { id: 'mA', role: 'coach' } as any,
      rows: { members: {}, seasons: {}, events: {}, rsvps: { 'e1:mX': { note: 'COACH-ONLY NOTE' } }, counts: {}, sheets: { s1: { status: 'draft' } }, plays: {}, drills: {}, plans: {} } } as any);
    const { app } = await import('./app.svelte');
    await app.signedIn();
    console.log('B SNAP', app.snap?.me.id, JSON.stringify(app.snap?.rows.rsvps), JSON.stringify(app.snap?.rows.sheets));
  });
});
