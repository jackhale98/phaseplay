import { env } from 'cloudflare:test';
import { uuidv7 } from '@phaseplay/shared';
import { createApp } from '../src/app';

export const app = createApp();
export const ORIGIN = 'http://localhost:8787';

export type Res = { status: number; body: any; headers: Headers; queries: number };

export async function call(
  method: string,
  path: string,
  opts: { cookie?: string; body?: unknown; ifMatch?: number; origin?: string | null } = {},
): Promise<Res> {
  const headers: Record<string, string> = {};
  if (opts.cookie) headers.cookie = opts.cookie;
  if (opts.origin !== null) headers.origin = opts.origin ?? ORIGIN;
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  if (opts.ifMatch) headers['if-match'] = String(opts.ifMatch);
  const res = await app.request(
    `http://localhost:8787${path}`,
    { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) },
    { ...env, ASSETS: { fetch: async () => new Response('shell') } },
  );
  const text = await res.text();
  let body: any = text;
  try {
    body = JSON.parse(text);
  } catch {}
  return {
    status: res.status,
    body,
    headers: res.headers,
    queries: Number(res.headers.get('x-pp-queries') ?? 0),
  };
}

export async function login(displayName = 'Test User') {
  const userId = uuidv7();
  const res = await call('POST', '/api/v1/test/login', { body: { userId, displayName } });
  const cookie = (res.headers.get('set-cookie') ?? '').split(';')[0]!;
  return { userId, cookie, displayName };
}

export type Actor = Awaited<ReturnType<typeof login>> & { memberId: string };

/** A team with an owner, coach, manager, player and a removed player, plus one of each resource. */
export async function fixtureTeam(name = 'Phaseplay RFC') {
  const owner = await login(`${name} Owner`);
  const teamId = uuidv7();
  const r = await call('POST', '/api/v1/teams', {
    cookie: owner.cookie,
    body: {
      id: teamId,
      name,
      shortName: 'PRFC',
      colors: { primary: '#1f6f43', secondary: '#f2c230' },
      defaultFormat: '15s',
      timezone: 'Europe/London',
    },
  });
  if (r.status !== 201) throw new Error(`team create failed ${JSON.stringify(r.body)}`);
  const me = await call('GET', '/api/v1/me', { cookie: owner.cookie });
  const ownerA: Actor = { ...owner, memberId: me.body.memberships[0].member.id };

  async function join(role: 'admin' | 'coach' | 'manager' | 'player', who: string): Promise<Actor> {
    const inv = await call('POST', `/api/v1/teams/${teamId}/invites`, {
      cookie: owner.cookie,
      body: { id: uuidv7(), role, maxUses: 5 },
    });
    const u = await login(who);
    const acc = await call('POST', '/api/v1/invites/accept', {
      cookie: u.cookie,
      body: { token: inv.body.token },
    });
    if (acc.status !== 200) throw new Error(`accept failed ${JSON.stringify(acc.body)}`);
    return { ...u, memberId: acc.body.memberId };
  }
  const admin = await join('admin', 'Admin Ada');
  const coach = await join('coach', 'Coach Cara');
  const manager = await join('manager', 'Manager Mo');
  const player = await join('player', 'Player Pip');
  const removed = await join('player', 'Removed Rae');
  await call('DELETE', `/api/v1/teams/${teamId}/members/${removed.memberId}`, {
    cookie: owner.cookie,
  });

  const eventId = uuidv7();
  await call('POST', `/api/v1/teams/${teamId}/events`, {
    cookie: owner.cookie,
    body: {
      id: eventId,
      type: 'match',
      format: '15s',
      title: 'League',
      opponent: 'Rivals',
      startsAt: Date.now() + 86400e3,
    },
  });
  const sheetId = uuidv7();
  await call('PUT', `/api/v1/teams/${teamId}/sheets/${sheetId}`, {
    cookie: owner.cookie,
    body: {
      eventId,
      format: '15s',
      replacements: 8,
      slots: { '1': player.memberId },
      captainId: null,
      viceId: null,
    },
  });
  const playId = uuidv7();
  await call('POST', `/api/v1/teams/${teamId}/plays`, {
    cookie: owner.cookie,
    body: playBody(playId, 'team'),
  });
  const drillId = uuidv7();
  await call('POST', `/api/v1/teams/${teamId}/drills`, {
    cookie: owner.cookie,
    body: drillBody(drillId),
  });
  const planId = uuidv7();
  await call('POST', `/api/v1/teams/${teamId}/plans`, {
    cookie: owner.cookie,
    body: {
      id: planId,
      title: 'Tuesday',
      data: {
        lanes: ['all'],
        slots: [
          {
            id: 's1',
            blocks: [{ id: 'b1', kind: 'drill', drillId, durationMin: 10, lane: 'all' }],
          },
        ],
      },
    },
  });
  const inv = await call('POST', `/api/v1/teams/${teamId}/invites`, {
    cookie: owner.cookie,
    body: { id: uuidv7(), role: 'player' },
  });
  const recurrenceId = uuidv7();
  await call('POST', `/api/v1/teams/${teamId}/recurrences`, {
    cookie: owner.cookie,
    body: {
      id: recurrenceId,
      title: 'Training',
      rule: {
        weekdays: [2, 4],
        time: '19:00',
        durationMin: 90,
        startsOn: '2030-01-01',
        until: '2030-01-31',
      },
    },
  });
  const roleId = uuidv7();
  await call('PUT', `/api/v1/teams/${teamId}/roles/${roleId}`, {
    cookie: owner.cookie,
    body: { name: 'Captain', color: '#f2c230', permissions: ['practice.view_private'] },
  });
  return {
    teamId,
    owner: ownerA,
    admin,
    coach,
    manager,
    player,
    removed,
    eventId,
    sheetId,
    playId,
    drillId,
    planId,
    inviteId: inv.body.id as string,
    recurrenceId,
    roleId,
  };
}

export function playBody(id: string, visibility: 'team' | 'coaches') {
  return {
    id,
    title: 'Lineout 5 – front ball',
    category: 'lineout',
    tags: ['lineout'],
    format: '15s',
    visibility,
    data: {
      v: 1,
      id,
      mode: 'play',
      title: 'Lineout 5',
      format: '15s',
      view: 'lineout',
      entities: [{ id: 'a1', kind: 'attack', number: 2 }],
      frames: [
        { id: 'f0', durationMs: 0, pos: { a1: { x: 1, y: 40 } }, moves: {} },
        {
          id: 'f1',
          durationMs: 1000,
          pos: { a1: { x: 5, y: 40 } },
          moves: { a1: { kind: 'run' } },
        },
      ],
    },
  };
}

export function drillBody(id: string, visibility: 'team' | 'coaches' = 'team') {
  return {
    id,
    title: 'Grid passing',
    category: 'handling',
    contactLevel: 'none',
    intensity: 2,
    playersMin: 4,
    playersMax: 12,
    area: { w: 20, h: 20 },
    equipment: { cones: 4 },
    defaultDurationMin: 10,
    visibility,
  };
}
