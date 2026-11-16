import { describe, it, expect } from 'vitest';
import { uuidv7 } from '@phaseplay/shared';
import { call, fixtureTeam, login } from './helpers';

describe('review', () => {
  it('coach can issue relink for owner', async () => {
    const a = await fixtureTeam();
    const r = await call('POST', `/api/v1/teams/${a.teamId}/members/${a.owner.memberId}/relink`, {
      cookie: a.coach.cookie,
      body: { id: uuidv7(), memberId: a.owner.memberId },
    });
    console.log('RELINK owner by coach', r.status, JSON.stringify(r.body).slice(0, 120));
    const o = await call('POST', '/api/v1/auth/relink/options', { body: { token: r.body.token } });
    console.log('RELINK options', o.status, o.body.displayName);
  });
  it('second sheet id for same event', async () => {
    const a = await fixtureTeam();
    const r = await call('PUT', `/api/v1/teams/${a.teamId}/sheets/${uuidv7()}`, {
      cookie: a.coach.cookie,
      body: { eventId: a.eventId, format: '15s', replacements: 8, slots: {}, captainId: null, viceId: null },
    });
    console.log('SECOND SHEET', r.status, JSON.stringify(r.body).slice(0, 200));
  });
  it('visibility flip not synced to player', async () => {
    const a = await fixtureTeam();
    const s1 = await call('GET', `/api/v1/teams/${a.teamId}/sync`, { cookie: a.player.cookie });
    const cur = s1.body.plays.find((p: any) => p.id === a.playId);
    const u = await call('PATCH', `/api/v1/teams/${a.teamId}/plays/${a.playId}`, {
      cookie: a.coach.cookie, ifMatch: cur.version, body: { visibility: 'coaches', title: 'Secret new title' },
    });
    const s2 = await call('GET', `/api/v1/teams/${a.teamId}/sync?since=${s1.body.cursor - 20000}`, { cookie: a.player.cookie });
    console.log('FLIP', u.status, 'player delta plays:', JSON.stringify(s2.body.plays));
  });
  it('demo session cannot use login/register', async () => {
    const d = await call('POST', '/api/v1/demo', { body: {} });
    const cookie = (d.headers.get('set-cookie') ?? '').split(';')[0]!;
    const r = await call('POST', '/api/v1/auth/login/options', { cookie, body: {} });
    const p = await call('POST', '/api/v1/invites/preview', { cookie, body: { token: 'x'.repeat(22) } });
    console.log('DEMO', d.status, 'login.options', r.status, r.body?.error?.code, 'preview', p.status, p.body?.error?.code);
  });
  it('failed claim consumes invite', async () => {
    const a = await fixtureTeam();
    const pid = uuidv7();
    await call('POST', `/api/v1/teams/${a.teamId}/members/pending`, { cookie: a.coach.cookie, body: { id: pid, displayName: 'Pend', positions: [] } });
    const inv = await call('POST', `/api/v1/teams/${a.teamId}/invites`, { cookie: a.owner.cookie, body: { id: uuidv7(), role: 'player', maxUses: 2 } });
    const u1 = await login('U1'); const u2 = await login('U2'); const u3 = await login('U3');
    const r1 = await call('POST', '/api/v1/invites/accept', { cookie: u1.cookie, body: { token: inv.body.token, claimMemberId: pid } });
    const r2 = await call('POST', '/api/v1/invites/accept', { cookie: u2.cookie, body: { token: inv.body.token, claimMemberId: pid } });
    const r3 = await call('POST', '/api/v1/invites/accept', { cookie: u3.cookie, body: { token: inv.body.token } });
    console.log('CLAIM', r1.status, r2.status, r3.status, JSON.stringify(r3.body).slice(0, 100));
  });
});
