import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';

const calls: any[] = [];
let rejectNext = false;
vi.mock('#lib/api', async () => {
  const real = await vi.importActual<any>('#lib/api');
  return {
    ...real,
    v1: (p: string) => `/api/v1${p}`,
    api: vi.fn(async (path: string, init: any = {}) => {
      calls.push([path, init.method]);
      if (path.includes('/sync')) {
        return {
          cursor: Date.now(),
          full: calls.filter((c) => c[0].includes('/sync')).length === 1,
          team: { id: 't1', name: 'T', colors: null },
          me: { id: 'm1', role: 'player' },
          members: [],
          seasons: [],
          events: [],
          rsvps: [],
          rsvpCounts: {},
          sheets: [],
          plays: [],
          drills: [],
          plans: [],
        };
      }
      if (init.method === 'PUT') {
        await new Promise((r) => setTimeout(r, 20));
        if (rejectNext) throw new real.ApiError(400, 'bad_request', 'nope');
      }
      return {};
    }),
  };
});
vi.mock('#lib/stores/toast.svelte', () => ({ toasts: { show() {}, error() {}, undo() {} } }));
vi.mock('#lib/stores/theme.svelte', () => ({ theme: { init() {}, applyTeam() {} } }));

describe('review', () => {
  it('sync during pending write persists optimistic op; 4xx does not roll back', async () => {
    vi.stubGlobal('navigator', { onLine: true });
    const { app } = await import('./app.svelte');
    const { loadSnapshot } = await import('./idb');
    app.teamId = 't1';
    await app.sync(); // full
    rejectNext = true;
    app.online = false; // queue without sending
    await app.mutate({
      method: 'PUT',
      path: '/api/v1/teams/t1/x',
      body: {},
      label: 'x',
      optimistic: [{ op: 'put', entity: 'rsvps', key: 'e1:m1', value: { status: 'yes' } }],
    });
    await app.sync(); // delta while pending
    const stored = await loadSnapshot('t1');
    console.log(
      'STORED rsvps after delta sync with pending write:',
      JSON.stringify(stored?.rows.rsvps),
    );
    app.online = true;
    await app.flush();
    await new Promise((r) => setTimeout(r, 50));
    console.log('SNAP rsvps after 400 rollback:', JSON.stringify(app.snap?.rows.rsvps));
  });
});
