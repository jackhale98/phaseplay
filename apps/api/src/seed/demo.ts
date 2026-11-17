/**
 * The demo team "Phaseplay RFC" (docs/testing-ci.md §Seed data), as plain rows per table.
 * Used by `pnpm db:seed` (local SQL) and by the Worker's public demo (refreshed daily so its dates
 * stay current). Deterministic ids; dates are relative to the current week. Fictional people only.
 */
import {
  zonedToUtc,
  addDays,
  INVENTORY_HANDOFF_TTL_MS,
  dateInTz,
  type Entity,
  type Frame,
  type Move,
  type Play,
  type MatchPayload,
  type PlanData,
  type Vec2,
  type View,
  type Viewport,
} from '@phaseplay/shared';
import { lineout, scrum15 } from '@phaseplay/diagram/presets';
import { STARTER_DRILLS } from './starter-drills';
import { starterDiagram } from './starter-diagrams';

export const DEMO_TEAM_ID = 'a0000000-0000-7000-8000-000000000001';
/** The demo coach ("Sam Carter"). Has no passkey; the API refuses every write from this account. */
export const DEMO_USER_ID = 'b0000000-0000-7000-8000-000000000002';
/** Insert order respects foreign keys. */
export const DEMO_TABLE_ORDER = [
  'users',
  'teams',
  'team_roles',
  'memberships',
  'seasons',
  'recurrences',
  'events',
  'rsvps',
  'team_sheets',
  'plays',
  'drills',
  'practice_plans',
  'match_events',
  'audit_log',
  'inventory_items',
  'inventory_events',
  'inventory_handoffs',
] as const;
export type DemoTables = Record<(typeof DEMO_TABLE_ORDER)[number], Record<string, unknown>[]>;

export function buildDemo(now: number = Date.now()): DemoTables {
  const TZ = 'America/New_York';
  let n = 0;
  const id = (prefix: string) => {
    n++;
    const hex = prefix
      .replace(/[^0-9a-f]/g, '')
      .padEnd(8, '0')
      .slice(0, 8);
    return `${hex}-0000-7000-8000-${n.toString(16).padStart(12, '0')}`;
  };
  let seed = 42;
  const rand = () => (seed = (seed * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32;
  const tables = Object.fromEntries(DEMO_TABLE_ORDER.map((t) => [t, []])) as unknown as DemoTables;
  const insert = (table: keyof DemoTables, row: Record<string, unknown>) => tables[table].push(row);

  const today = dateInTz(now, TZ);
  // Monday of this week
  const dow = (new Date(today + 'T12:00:00Z').getUTCDay() + 6) % 7;
  const monday = addDays(today, -dow);

  const TEAM = DEMO_TEAM_ID;

  // People
  const staff = [
    { name: 'Sam Carter', role: 'owner', positions: [] as number[] },
    { name: 'Alex Morgan', role: 'coach', positions: [] },
    { name: 'Priya Shah', role: 'admin', positions: [] },
  ];
  const PLAYERS: [string, number[]][] = [
    ['Jess Taylor', [1, 3]],
    ['Megan Hughes', [1]],
    ['Ffion Davies', [2]],
    ['Lowri Evans', [2, 1]],
    ['Hannah Price', [3]],
    ['Cerys Morgan', [3, 1]],
    ['Rhian Lewis', [4, 5]],
    ['Bethan Jones', [5, 4]],
    ['Sian Roberts', [4, 6]],
    ['Amy Walker', [6, 7]],
    ['Grace Thomas', [7]],
    ['Ellie Wright', [8, 6]],
    ['Nia Griffiths', [6, 8]],
    ['Katie Bennett', [9]],
    ['Mali Pugh', [9, 10]],
    ['Zara Khan', [10, 12]],
    ['Olivia Reed', [10, 15]],
    ['Chloe Martin', [12, 13]],
    ['Isla Murray', [13, 12]],
    ['Freya Collins', [12]],
    ['Ruby Hall', [11, 14]],
    ['Poppy Ward', [14, 11]],
    ['Leah Cooper', [15, 14]],
    ['Tegan Fox', [11]],
    ['Maya Brooks', [15]],
    ['Erin Kelly', [13]],
    ['Abi Turner', [7, 8]],
    ['Holly Ellis', [2, 3]],
    ['Sophie Bell', [5]],
    ['Lucy Webb', [14]],
  ];
  type M = {
    id: string;
    userId: string;
    name: string;
    role: string;
    positions: number[];
    jersey: number | null;
  };
  const members: M[] = [];
  for (const s of staff)
    members.push({
      id: id('c'),
      userId: id('b'),
      name: s.name,
      role: s.role,
      positions: s.positions,
      jersey: null,
    });
  PLAYERS.forEach(([name, positions], i) =>
    members.push({
      id: id('c'),
      userId: id('b'),
      name,
      role: 'player',
      positions,
      jersey: positions[0]! <= 15 && i < 23 ? positions[0]! : null,
    }),
  );
  // two imported names who haven't joined yet
  const pendingNames = ['Bea Lloyd', 'Carys Rees'];
  const owner = members[0]!;

  insert('teams', {
    id: TEAM,
    name: 'Phaseplay RFC',
    short_name: 'PRFC',
    colors: JSON.stringify({ primary: '#1f6f43', secondary: '#f2c230' }),
    default_format: '15s',
    timezone: TZ,
    owner_id: owner.userId,
    created_at: now - 90 * 86400e3,
    updated_at: now,
  });
  // Team roles: captains see the practice plans and who's available; the social sec runs the calendar.
  const captainRole = id('d');
  const viceRole = id('d');
  const socialRole = id('d');
  const roleRows: [string, string, string, string[]][] = [
    [
      captainRole,
      'Captain',
      '#f2c230',
      ['practice.view_private', 'availability.view', 'sheets.view_draft'],
    ],
    [viceRole, 'Vice-captain', '#c9a227', ['practice.view_private', 'availability.view']],
    [socialRole, 'Social sec', '#7b4fa0', ['events.manage']],
  ];
  for (const [rid, name, color, perms] of roleRows)
    insert('team_roles', {
      id: rid,
      team_id: TEAM,
      name,
      color,
      permissions: JSON.stringify(perms),
      created_at: now - 60 * 86400e3,
      updated_at: now,
    });
  const roleFor = new Map<number, string[]>([
    [staff.length + 3, [captainRole]],
    [staff.length + 9, [viceRole]],
    [staff.length + 12, [socialRole]],
  ]);
  for (const [i, m] of members.entries()) {
    insert('users', { id: m.userId, display_name: m.name, created_at: now - 80 * 86400e3 });
    insert('memberships', {
      id: m.id,
      team_id: TEAM,
      user_id: m.userId,
      display_name: m.name,
      role: m.role,
      jersey: m.jersey,
      positions: JSON.stringify(m.positions),
      status: 'active',
      role_ids: JSON.stringify(roleFor.get(i) ?? []),
      joined_at: now - 80 * 86400e3,
      updated_at: now,
    });
  }
  for (const name of pendingNames)
    insert('memberships', {
      id: id('c'),
      team_id: TEAM,
      user_id: null,
      display_name: name,
      role: 'player',
      positions: '[]',
      role_ids: '[]',
      status: 'pending',
      updated_at: now,
    });

  const season = id('5');
  insert('seasons', {
    id: season,
    team_id: TEAM,
    name: '2026–27',
    starts_on: addDays(monday, -60),
    ends_on: addDays(monday, 200),
    updated_at: now,
  });

  // Events: Tue/Thu training, Saturday matches, a 7s tournament day.
  type E = {
    id: string;
    type: string;
    startsAt: number;
    title: string;
    opponent?: string;
    format?: string;
  };
  const evs: E[] = [];
  const recurrence = id('e');
  insert('recurrences', {
    id: recurrence,
    team_id: TEAM,
    rule: JSON.stringify({
      weekdays: [2, 4],
      time: '19:00',
      durationMin: 90,
      meetBeforeMin: 15,
      startsOn: addDays(monday, -28),
      until: addDays(monday, 56),
    }),
    template: JSON.stringify({ title: 'Practice', locationName: 'Riverside Park, Pitch 2' }),
    created_at: now,
  });
  for (let w = -4; w <= 8; w++) {
    for (const d of [1, 3]) {
      const date = addDays(monday, w * 7 + d);
      const startsAt = zonedToUtc(date, '19:00', TZ);
      const e = { id: id('e'), type: 'training', startsAt, title: 'Practice' };
      evs.push(e);
      insert('events', {
        id: e.id,
        team_id: TEAM,
        season_id: season,
        type: 'training',
        title: 'Practice',
        starts_at: startsAt,
        meet_at: startsAt - 15 * 60e3,
        ends_at: startsAt + 90 * 60e3,
        location_name: 'Riverside Park, Pitch 2',
        location_url: 'https://www.openstreetmap.org/search?query=Riverside%20Park',
        recurrence_id: recurrence,
        version: 1,
        created_by: owner.userId,
        updated_at: now,
      });
    }
  }
  const opponents = [
    'Harbour Hawks',
    'Northgate Women',
    'Valley Vixens',
    'St Brides',
    'Castle Belles',
    'Old Millers',
  ];
  for (let w = -3; w <= 6; w++) {
    if (w === 3) continue;
    const date = addDays(monday, w * 7 + 5);
    const startsAt = zonedToUtc(date, '14:30', TZ);
    const opp = opponents[(w + 3) % opponents.length]!;
    const e = {
      id: id('e'),
      type: 'match',
      startsAt,
      title: 'League',
      opponent: opp,
      format: '15s',
    };
    evs.push(e);
    insert('events', {
      id: e.id,
      team_id: TEAM,
      season_id: season,
      type: 'match',
      format: '15s',
      title: 'League',
      opponent: opp,
      starts_at: startsAt,
      meet_at: startsAt - 90 * 60e3,
      ends_at: startsAt + 2 * 3600e3,
      location_name: w % 2 ? `${opp} RFC` : 'Riverside Park, Pitch 1',
      notes:
        w % 2
          ? 'Away. Minibus leaves the clubhouse at 11:45.'
          : 'Home. Teas after in the clubhouse.',
      version: 1,
      created_by: owner.userId,
      updated_at: now,
    });
  }
  {
    const date = addDays(monday, 3 * 7 + 5);
    const startsAt = zonedToUtc(date, '10:00', TZ);
    const e = { id: id('e'), type: 'tournament', startsAt, title: 'Summer 7s', format: '7s' };
    evs.push(e);
    insert('events', {
      id: e.id,
      team_id: TEAM,
      season_id: season,
      type: 'tournament',
      format: '7s',
      title: 'Summer 7s',
      starts_at: startsAt,
      meet_at: startsAt - 60 * 60e3,
      ends_at: startsAt + 7 * 3600e3,
      location_name: 'County Ground',
      notes: 'Pool games at 10:20, 11:40 and 13:00. Bring two kits.',
      version: 1,
      created_by: owner.userId,
      updated_at: now,
    });
  }
  const extras: [
    number,
    string,
    'social' | 'fundraiser' | 'meeting',
    string,
    number,
    string,
    string,
  ][] = [
    [
      12,
      '19:30',
      'social',
      'Quiz night',
      3,
      'The Lock Keeper',
      'Teams of six. £3 entry for the kitty.',
    ],
    [
      20,
      '09:00',
      'fundraiser',
      'Bag-pack fundraiser',
      6,
      'Riverside Superstore',
      'Two-hour shifts in club kit. Raising money for the new scrum machine.',
    ],
    [
      27,
      '18:30',
      'meeting',
      'Season planning meeting',
      1.5,
      'Clubhouse',
      'Captains and committee. Agenda in the group chat.',
    ],
    [
      34,
      '12:00',
      'social',
      'End-of-season BBQ',
      4,
      'Clubhouse lawn',
      'Families welcome. Bring a side dish.',
    ],
  ];
  for (const [day, at, type, title, hours, place, notes] of extras) {
    const startsAt = zonedToUtc(addDays(monday, day), at, TZ);
    insert('events', {
      id: id('e'),
      team_id: TEAM,
      season_id: season,
      type,
      title,
      starts_at: startsAt,
      ends_at: startsAt + hours * 3600e3,
      location_name: place,
      notes,
      version: 1,
      created_by: owner.userId,
      updated_at: now,
    });
  }

  // RSVPs and attendance
  for (const e of evs) {
    const past = e.startsAt < now;
    const window = e.startsAt - now < 21 * 86400e3;
    if (!past && !window) continue;
    for (const m of members.slice(3)) {
      const r = rand();
      if (!past && r < 0.18) continue; // not replied yet
      const status = r < 0.72 ? 'yes' : r < 0.85 ? 'maybe' : 'no';
      const note = status === 'no' && rand() < 0.3 ? 'Working that day, sorry!' : null;
      insert('rsvps', {
        event_id: e.id,
        member_id: m.id,
        team_id: TEAM,
        status,
        note,
        note_expires_at: note ? e.startsAt + 30 * 86400e3 : null,
        attended: past ? (status === 'yes' ? (rand() < 0.93 ? 1 : 0) : 0) : null,
        updated_at: now - Math.floor(rand() * 86400e3),
      });
    }
  }

  // Team sheets: last match (published) and the next match (draft).
  const matches = evs.filter((e) => e.type === 'match').sort((a, b) => a.startsAt - b.startsAt);
  const lastMatch = [...matches].reverse().find((m) => m.startsAt < now)!;
  const nextMatch = matches.find((m) => m.startsAt > now)!;
  const pickSheet = () => {
    const used = new Set<string>();
    const slots: Record<string, string | null> = {};
    for (let s = 1; s <= 23; s++) {
      const want = s <= 15 ? s : [1, 2, 3, 4, 7, 9, 12, 15][s - 16]!;
      const m =
        members.slice(3).find((x) => !used.has(x.id) && x.positions[0] === want) ??
        members.slice(3).find((x) => !used.has(x.id) && x.positions.includes(want)) ??
        members.slice(3).find((x) => !used.has(x.id));
      if (m) used.add(m.id);
      slots[String(s)] = m?.id ?? null;
    }
    return slots;
  };
  const sheetSlotsByEvent: Record<string, Record<string, string | null>> = {};
  for (const [ev, published] of [
    [lastMatch, true],
    [nextMatch, false],
  ] as const) {
    const slots = pickSheet();
    sheetSlotsByEvent[ev.id] = slots;
    const captain = slots['8'];
    const snap = JSON.stringify({
      format: '15s',
      replacements: 8,
      slots,
      captainId: captain,
      viceId: slots['10'],
      publishedAt: ev.startsAt - 2 * 86400e3,
    });
    insert('team_sheets', {
      id: id('5e'),
      event_id: ev.id,
      team_id: TEAM,
      format: '15s',
      replacements: 8,
      slots: JSON.stringify(slots),
      captain_id: captain,
      vice_id: slots['10'],
      status: published ? 'published' : 'draft',
      published: published ? snap : null,
      version: published ? 2 : 1,
      published_at: published ? ev.startsAt - 2 * 86400e3 : null,
      created_by: owner.userId,
      updated_at: now - (published ? 5 : 1) * 86400e3,
    });
  }

  // Plays: built from the shared presets, with real frames (see DEMO_PLAYS below).
  for (const def of DEMO_PLAYS) {
    const pid = id('91a');
    const data = def.build(pid);
    insert('plays', {
      id: pid,
      team_id: TEAM,
      title: def.title,
      category: def.category,
      tags: JSON.stringify([def.category]),
      format: '15s',
      visibility: def.category === 'defence' ? 'coaches' : 'team',
      description: def.description,
      data: JSON.stringify(data),
      frame_count: data.frames.length,
      version: 1,
      created_by: owner.userId,
      created_at: now - 20 * 86400e3,
      updated_at: now - Math.floor(rand() * 20) * 86400e3,
    });
  }

  // Drills: the starter pack (12 shown in docs; we seed all 16).
  const drillIds: Record<string, string> = {};
  STARTER_DRILLS.forEach((d, i) => {
    const did = id('d1');
    drillIds[d.key] = did;
    const diagram = starterDiagram(d.key);
    insert('drills', {
      id: did,
      team_id: TEAM,
      title: d.title,
      category: d.category,
      contact_level: d.contactLevel,
      intensity: d.intensity,
      players_min: d.players[0],
      players_max: d.players[1],
      area: JSON.stringify({ w: d.area[0], h: d.area[1] }),
      equipment: JSON.stringify(d.equipment),
      default_duration_min: d.minutes,
      description: d.description,
      coaching_points: JSON.stringify(d.coachingPoints),
      setup: d.setup,
      variations: JSON.stringify(d.variations),
      diagram: diagram ? JSON.stringify(diagram) : null,
      visibility: 'team',
      source: 'starter',
      version: 1,
      created_at: now - i,
      updated_at: now - i,
    });
  });

  // Practice plans: a split session with a rotation, and a simple template.
  const nextTraining = evs
    .filter((e) => e.type === 'training' && e.startsAt > now)
    .sort((a, b) => a.startsAt - b.startsAt)[0]!;
  const split: PlanData = {
    lanes: ['forwards', 'backs'],
    waterEveryMin: 22,
    slots: [
      {
        id: 's1',
        blocks: [
          {
            id: 'b1',
            kind: 'drill',
            drillId: drillIds['dynamic-warmup'],
            durationMin: 10,
            lane: 'all',
          },
        ],
      },
      {
        id: 's2',
        blocks: [
          {
            id: 'b2',
            kind: 'drill',
            drillId: drillIds['triangle-passing'],
            durationMin: 10,
            lane: 'all',
          },
        ],
      },
      { id: 's3', blocks: [{ id: 'b3', kind: 'water', durationMin: 3, lane: 'all' }] },
      {
        id: 's4',
        blocks: [
          {
            id: 'b4',
            kind: 'drill',
            drillId: drillIds['ruck-lanes'],
            durationMin: 15,
            lane: 'forwards',
            notes: 'Low body height, arrive in pairs.',
          },
          { id: 'b5', kind: 'drill', drillId: drillIds['3v2'], durationMin: 15, lane: 'backs' },
        ],
      },
      {
        id: 's5',
        blocks: [
          {
            id: 'b6',
            kind: 'custom',
            title: 'Lineout walk-through',
            durationMin: 12,
            lane: 'forwards',
          },
          { id: 'b7', kind: 'drill', drillId: drillIds['2v1'], durationMin: 12, lane: 'backs' },
        ],
      },
      { id: 's6', blocks: [{ id: 'b8', kind: 'water', durationMin: 3, lane: 'all' }] },
      {
        id: 's7',
        blocks: [
          {
            id: 'b9',
            kind: 'drill',
            drillId: drillIds['tackle-tubes'],
            durationMin: 1,
            lane: 'all',
            rotation: { groups: 3, stations: ['Tubes', 'Tackle box', 'Jackal'], intervalMin: 6 },
          },
        ],
      },
      {
        id: 's8',
        blocks: [
          { id: 'b10', kind: 'game', title: 'Conditioned game', durationMin: 15, lane: 'all' },
        ],
      },
      {
        id: 's9',
        blocks: [
          { id: 'b11', kind: 'talk', title: 'Team talk: Saturday', durationMin: 5, lane: 'all' },
        ],
      },
    ],
  };
  insert('practice_plans', {
    id: id('9a'),
    team_id: TEAM,
    event_id: nextTraining.id,
    title: 'Tuesday: breakdown + strike',
    is_template: 0,
    visibility: 'team',
    blocks: JSON.stringify(split),
    planned_total_min: 91,
    version: 1,
    created_by: owner.userId,
    created_at: now,
    updated_at: now,
  });
  const simple: PlanData = {
    lanes: ['all'],
    waterEveryMin: 22,
    slots: [
      {
        id: 's1',
        blocks: [
          {
            id: 'b1',
            kind: 'drill',
            drillId: drillIds['dynamic-warmup'],
            durationMin: 10,
            lane: 'all',
          },
        ],
      },
      {
        id: 's2',
        blocks: [
          {
            id: 'b2',
            kind: 'drill',
            drillId: drillIds['square-grid'],
            durationMin: 12,
            lane: 'all',
          },
        ],
      },
      { id: 's3', blocks: [{ id: 'b3', kind: 'water', durationMin: 3, lane: 'all' }] },
      {
        id: 's4',
        blocks: [
          {
            id: 'b4',
            kind: 'drill',
            drillId: drillIds['line-speed'],
            durationMin: 15,
            lane: 'all',
          },
        ],
      },
      {
        id: 's5',
        blocks: [
          {
            id: 'b5',
            kind: 'drill',
            drillId: drillIds['touch-game'],
            durationMin: 15,
            lane: 'all',
          },
        ],
      },
    ],
  };
  insert('practice_plans', {
    id: id('9a'),
    team_id: TEAM,
    event_id: null,
    title: 'Template: Thursday handling',
    is_template: 1,
    visibility: 'team',
    blocks: JSON.stringify(simple),
    planned_total_min: 55,
    version: 1,
    created_by: owner.userId,
    created_at: now,
    updated_at: now,
  });

  // A recorded match log for the last match: tries, a yellow, subs and time off.
  {
    const ko = lastMatch.startsAt;
    let seq = 0;
    // Slot order from the published sheet: xv[0..14] starters, xv[15..22] bench.
    const lastSlots = sheetSlotsByEvent[lastMatch.id]!;
    const xv = Array.from({ length: 23 }, (_, i) => lastSlots[String(i + 1)]!);
    const add = (minute: number, payload: MatchPayload, wallOffset = 0) =>
      insert('match_events', {
        id: id('3e'),
        event_id: lastMatch.id,
        team_id: TEAM,
        seq: seq++,
        kind: payload.kind,
        payload: JSON.stringify(payload),
        game_ms: minute * 60e3,
        wall_at: ko + minute * 60e3 + wallOffset,
        supersedes_id: null,
        created_by: owner.userId,
        created_at: ko,
      });
    add(0, { kind: 'period_start', period: 1 });
    add(6, { kind: 'score', team: 'us', type: 'try', playerId: xv[13] });
    add(7, { kind: 'score', team: 'us', type: 'conversion', playerId: xv[9] });
    add(14, {
      kind: 'penalty',
      side: 'against',
      offence: 'ruck',
      zone: { x: 0.4, y: 0.35 },
      outcome: 'kick_to_touch',
    });
    add(18, { kind: 'score', team: 'them', type: 'penalty_goal' });
    add(23, { kind: 'time_off', reason: 'injury' });
    add(23, { kind: 'time_on' }, 3 * 60e3);
    add(31, { kind: 'card', team: 'them', colour: 'yellow' }, 3 * 60e3);
    add(35, { kind: 'score', team: 'us', type: 'try', playerId: xv[7] }, 3 * 60e3);
    add(36, { kind: 'score', team: 'us', type: 'conversion_miss', playerId: xv[9] }, 3 * 60e3);
    add(40, { kind: 'period_end', period: 1 }, 3 * 60e3);
    add(40, { kind: 'period_start', period: 2 }, 15 * 60e3);
    add(52, { kind: 'sub', team: 'us', offId: xv[0]!, onId: xv[15]!, type: 'tactical' }, 15 * 60e3);
    add(55, { kind: 'score', team: 'them', type: 'try' }, 15 * 60e3);
    add(56, { kind: 'score', team: 'them', type: 'conversion' }, 15 * 60e3);
    add(61, { kind: 'sub', team: 'us', offId: xv[8]!, onId: xv[16]!, type: 'tactical' }, 15 * 60e3);
    add(63, { kind: 'score', team: 'us', type: 'try', playerId: xv[13] }, 15 * 60e3);
    add(
      68,
      {
        kind: 'penalty',
        side: 'for',
        offence: 'offside',
        zone: { x: 0.6, y: 0.7 },
        outcome: 'kick_at_goal',
      },
      15 * 60e3,
    );
    add(69, { kind: 'score', team: 'us', type: 'penalty_goal', playerId: xv[9] }, 15 * 60e3);
    add(80, { kind: 'period_end', period: 2 }, 15 * 60e3);
  }

  // Season stats (PLAN.md M7): earlier league games and a 7s day with published sheets and match
  // logs, practice plans on past practices, and the latest practice with no register taken.
  {
    const squad = members.slice(3);
    type Entry = [minute: number, payload: MatchPayload, wallOffset?: number, rowId?: string];
    const logMatch = (eventId: string, ko: number, entries: Entry[]) =>
      entries.forEach(([minute, payload, wallOffset = 0, rowId], i) =>
        insert('match_events', {
          id: rowId ?? id('3e'),
          event_id: eventId,
          team_id: TEAM,
          seq: i,
          kind: payload.kind,
          payload: JSON.stringify(payload),
          game_ms: Math.round(minute * 60e3),
          wall_at: ko + Math.round((minute + wallOffset) * 60e3),
          supersedes_id: null,
          created_by: owner.userId,
          created_at: ko,
        }),
      );
    const publishSheet = (
      ev: { id: string; startsAt: number },
      format: '15s' | '7s',
      replacements: number,
      slots: Record<string, string | null>,
    ) => {
      const captain = slots[format === '15s' ? '8' : '4'] ?? null;
      const publishedAt = ev.startsAt - 2 * 86400e3;
      insert('team_sheets', {
        id: id('5e'),
        event_id: ev.id,
        team_id: TEAM,
        format,
        replacements,
        slots: JSON.stringify(slots),
        captain_id: captain,
        vice_id: null,
        status: 'published',
        published: JSON.stringify({
          format,
          replacements,
          slots,
          captainId: captain,
          viceId: null,
          publishedAt,
        }),
        version: 2,
        published_at: publishedAt,
        created_by: owner.userId,
        updated_at: publishedAt,
      });
    };
    /** The usual XV with a few changes (slot ↔ slot swaps). */
    const rotated = (swaps: [number, number][]) => {
      const s = pickSheet();
      for (const [a, b] of swaps)
        [s[String(a)], s[String(b)]] = [s[String(b)] ?? null, s[String(a)] ?? null];
      return s;
    };
    type Slots = Record<string, string | null>;
    const sub = (s: Slots, off: number, on: number): MatchPayload => ({
      kind: 'sub',
      team: 'us',
      offId: s[String(off)]!,
      onId: s[String(on)]!,
      type: 'tactical',
    });
    const us = (
      type: 'try' | 'conversion' | 'conversion_miss' | 'penalty_goal' | 'drop_goal',
      s: Slots,
      slot: number,
    ): MatchPayload => ({
      kind: 'score',
      team: 'us',
      type,
      playerId: s[String(slot)],
    });
    const them = (type: 'try' | 'conversion' | 'penalty_goal'): MatchPayload => ({
      kind: 'score',
      team: 'them',
      type,
    });
    const pen = (
      offence: 'offside' | 'ruck' | 'scrum' | 'high_tackle' | 'not_releasing',
      x: number,
      y: number,
    ): MatchPayload => ({
      kind: 'penalty',
      side: 'against',
      offence,
      zone: { x, y },
      outcome: 'kick_to_touch',
    });
    const HT = 15; // wall minutes of half time

    const [first, second] = matches.filter((m) => m.startsAt < now && m.id !== lastMatch.id);
    if (first) {
      // A bruising 12–17 loss, with penalties piling up at the breakdown.
      const s = rotated([
        [1, 16],
        [12, 22],
      ]);
      publishSheet(first, '15s', 8, s);
      logMatch(first.id, first.startsAt, [
        [0, { kind: 'period_start', period: 1 }],
        [4, pen('offside', 0.5, 0.4)],
        [9, them('try')],
        [10, them('conversion')],
        [16, pen('ruck', 0.35, 0.55)],
        [21, us('try', s, 11)],
        [22, us('conversion_miss', s, 10)],
        [28, pen('not_releasing', 0.6, 0.3)],
        [33, pen('ruck', 0.45, 0.62)],
        [40, { kind: 'period_end', period: 1 }],
        [40, { kind: 'period_start', period: 2 }, HT],
        [47, them('try'), HT],
        [50, sub(s, 1, 16), HT],
        [52, pen('high_tackle', 0.3, 0.45), HT],
        [55, sub(s, 9, 21), HT],
        [58, us('try', s, 7), HT],
        [59, us('conversion', s, 10), HT],
        [62, pen('offside', 0.55, 0.5), HT],
        [64, sub(s, 6, 20), HT],
        [70, them('try'), HT],
        [74, pen('ruck', 0.4, 0.7), HT],
        [80, { kind: 'period_end', period: 2 }, HT],
      ]);
    }
    if (second) {
      // A 15–15 draw, with a yellow card at the breakdown.
      const s = rotated([
        [9, 21],
        [4, 19],
      ]);
      publishSheet(second, '15s', 8, s);
      const yc = id('3e');
      logMatch(second.id, second.startsAt, [
        [0, { kind: 'period_start', period: 1 }],
        [7, us('try', s, 14)],
        [8, us('conversion_miss', s, 10)],
        [12, pen('scrum', 0.5, 0.35)],
        [19, them('try')],
        [20, them('conversion')],
        [26, pen('ruck', 0.42, 0.58)],
        [31, us('try', s, 2)],
        [32, us('conversion_miss', s, 10)],
        [40, { kind: 'period_end', period: 1 }],
        [40, { kind: 'period_start', period: 2 }, HT],
        [46, them('penalty_goal'), HT],
        [52, sub(s, 3, 18), HT],
        [55, pen('offside', 0.6, 0.48), HT],
        [57, { kind: 'card', team: 'us', colour: 'yellow', playerId: s['7'] }, HT, yc],
        [60, sub(s, 15, 23), HT],
        [66, them('try'), HT],
        [67, { kind: 'card_return', cardId: yc }, HT],
        [72, us('try', s, 13), HT],
        [73, us('conversion_miss', s, 10), HT],
        [80, { kind: 'period_end', period: 2 }, HT],
      ]);
    }

    // An autumn 7s day four weeks back: three pool games, two wins.
    const day7 = zonedToUtc(addDays(monday, -4 * 7 + 6), '10:00', TZ);
    const tid = id('e');
    insert('events', {
      id: tid,
      team_id: TEAM,
      season_id: season,
      type: 'tournament',
      format: '7s',
      title: 'Autumn 7s',
      starts_at: day7,
      meet_at: day7 - 60 * 60e3,
      ends_at: day7 + 6 * 3600e3,
      location_name: 'Castle Park',
      notes: 'Pool games at 10:20, 11:40 and 13:00.',
      version: 1,
      created_by: owner.userId,
      updated_at: now,
    });
    const sevens = [13, 15, 21, 16, 18, 20, 22, 9, 0, 4, 11, 24].map((i) => squad[i]!.id);
    const s7: Slots = Object.fromEntries(sevens.map((m, i) => [String(i + 1), m]));
    publishSheet({ id: tid, startsAt: day7 }, '7s', 5, s7);
    for (const m of squad) {
      const picked = sevens.includes(m.id);
      insert('rsvps', {
        event_id: tid,
        member_id: m.id,
        team_id: TEAM,
        status: picked || rand() < 0.3 ? 'yes' : 'no',
        note: null,
        note_expires_at: null,
        attended: picked ? 1 : 0,
        updated_at: day7,
      });
    }
    const H = 7;
    const day: Entry[] = [];
    /** Game g on the shared clock starts at (g − 1) × 2 halves; `at` is its wall start in minutes. */
    const game = (g: number, at: number, plays: [number, MatchPayload][]) => {
      const base = (g - 1) * 2 * H;
      const w1 = at - base;
      const w2 = w1 + 2;
      day.push([base, { kind: 'period_start', period: 2 * g - 1 }, w1]);
      for (const [m, p] of plays) if (m < H) day.push([base + m, p, w1]);
      day.push([base + H, { kind: 'period_end', period: 2 * g - 1 }, w1]);
      day.push([base + H, { kind: 'period_start', period: 2 * g }, w2]);
      for (const [m, p] of plays) if (m >= H) day.push([base + m, p, w2]);
      day.push([base + 2 * H, { kind: 'period_end', period: 2 * g }, w2]);
    };
    game(1, 20, [
      [2, us('try', s7, 6)],
      [2.5, us('conversion', s7, 5)],
      [9, them('try')],
      [10, them('conversion')],
      [11, us('try', s7, 7)],
      [11.5, us('conversion', s7, 5)],
      [13, us('try', s7, 4)],
    ]);
    game(2, 100, [
      [3, them('try')],
      [4, pen('offside', 0.5, 0.4)],
      [8, sub(s7, 1, 8)],
      [10, us('try', s7, 6)],
      [12, them('try')],
      [12.5, them('conversion')],
    ]);
    game(3, 180, [
      [1, us('try', s7, 7)],
      [1.5, us('conversion', s7, 5)],
      [5, them('try')],
      [8, sub(s7, 3, 9)],
      [9, pen('ruck', 0.45, 0.6)],
      [10, them('try')],
      [13, us('try', s7, 11)],
      [13.5, us('conversion', s7, 5)],
    ]);
    logMatch(tid, day7, day);

    // Practice plans on every past practice, so training load has a few weeks to show.
    const drill = (bid: string, key: string, durationMin: number, lane = 'all') => ({
      id: bid,
      kind: 'drill' as const,
      drillId: drillIds[key],
      durationMin,
      lane,
    });
    const water = (bid: string) => ({
      id: bid,
      kind: 'water' as const,
      durationMin: 3,
      lane: 'all',
    });
    const SESSIONS: { title: string; data: PlanData }[] = [
      {
        title: 'Contact and breakdown',
        data: {
          lanes: ['forwards', 'backs'],
          waterEveryMin: 22,
          slots: [
            { id: 's1', blocks: [drill('b1', 'dynamic-warmup', 12)] },
            { id: 's2', blocks: [drill('b2', 'tackle-tubes', 12)] },
            { id: 's3', blocks: [water('b3')] },
            {
              id: 's4',
              blocks: [drill('b4', 'ruck-lanes', 15, 'forwards'), drill('b5', '3v2', 15, 'backs')],
            },
            {
              id: 's5',
              blocks: [
                drill('b6', 'tackle-box', 10, 'forwards'),
                drill('b7', 'line-speed', 10, 'backs'),
              ],
            },
            { id: 's6', blocks: [water('b8')] },
            { id: 's7', blocks: [drill('b9', 'touch-game', 15)] },
          ],
        },
      },
      {
        title: 'Handling and fitness',
        data: {
          lanes: ['all'],
          waterEveryMin: 22,
          slots: [
            { id: 's1', blocks: [drill('b1', 'dynamic-warmup', 12)] },
            { id: 's2', blocks: [drill('b2', 'square-grid', 10)] },
            { id: 's3', blocks: [drill('b3', 'channel-passing', 10)] },
            { id: 's4', blocks: [water('b4')] },
            { id: 's5', blocks: [drill('b5', '2v1', 10)] },
            { id: 's6', blocks: [drill('b6', 'shuttles', 8)] },
            { id: 's7', blocks: [drill('b7', 'touch-game', 15)] },
          ],
        },
      },
      {
        title: 'Set piece and defence',
        data: {
          lanes: ['forwards', 'backs'],
          waterEveryMin: 22,
          slots: [
            { id: 's1', blocks: [drill('b1', 'dynamic-warmup', 12)] },
            {
              id: 's2',
              blocks: [
                drill('b2', 'lineout-pod', 15, 'forwards'),
                drill('b3', 'box-kick-chase', 15, 'backs'),
              ],
            },
            { id: 's3', blocks: [water('b4')] },
            {
              id: 's4',
              blocks: [
                drill('b5', 'jackal', 10, 'forwards'),
                drill('b6', 'channel-passing', 10, 'backs'),
              ],
            },
            { id: 's5', blocks: [drill('b7', 'line-speed', 15)] },
            { id: 's6', blocks: [drill('b8', 'shuttles', 8)] },
          ],
        },
      },
    ];
    const pastPractices = evs
      .filter((e) => e.type === 'training' && e.startsAt + 90 * 60e3 < now)
      .sort((a, b) => a.startsAt - b.startsAt);
    pastPractices.forEach((e, i) => {
      const sess = SESSIONS[i % SESSIONS.length]!;
      insert('practice_plans', {
        id: id('9a'),
        team_id: TEAM,
        event_id: e.id,
        title: sess.title,
        is_template: 0,
        visibility: 'team',
        blocks: JSON.stringify(sess.data),
        planned_total_min: 90,
        version: 1,
        created_by: owner.userId,
        created_at: e.startsAt - 3 * 86400e3,
        updated_at: e.startsAt - 3 * 86400e3,
      });
    });
    // Nobody took the register at the latest practice: stats fall back to RSVPs there.
    const latest = pastPractices.at(-1);
    if (latest) for (const r of tables.rsvps) if (r.event_id === latest.id) r.attended = null;
  }
  insert('audit_log', {
    id: id('ad'),
    team_id: TEAM,
    actor_id: owner.userId,
    action: 'team.created',
    target_type: 'team',
    target_id: TEAM,
    at: now - 90 * 86400e3,
  });
  // Kit: the shed, what people have at home, and a handover waiting for an answer.
  const byName = (name: string) => members.find((m) => m.name === name)!;
  const coach = byName('Alex Morgan');
  const KIT: {
    kind: string;
    name: string;
    tag?: string;
    quantity: number;
    condition?: string;
    home: string;
    matchDay?: boolean;
    holder?: string;
    notes?: string;
  }[] = [
    {
      kind: 'balls',
      name: 'Match balls',
      tag: 'BALL-M',
      quantity: 6,
      home: 'Kit shed',
      matchDay: true,
      holder: 'Katie Bennett',
    },
    { kind: 'balls', name: 'Training balls', tag: 'BALL-T', quantity: 14, home: 'Kit shed' },
    {
      kind: 'tackle_shields',
      name: 'Tackle shields',
      tag: 'SHIELD',
      quantity: 8,
      home: 'Kit shed',
    },
    {
      kind: 'tackle_bags',
      name: 'Tackle bags',
      quantity: 4,
      condition: 'worn',
      home: 'Pitch 2 cage',
    },
    {
      kind: 'bibs',
      name: 'Red bibs',
      tag: 'BIB-R',
      quantity: 15,
      home: 'Kit shed',
      holder: 'Megan Hughes',
      notes: 'Taken home to wash',
    },
    { kind: 'bibs', name: 'Blue bibs', tag: 'BIB-B', quantity: 15, home: 'Kit shed' },
    { kind: 'cones', name: 'Cones', quantity: 40, home: 'Kit shed' },
    {
      kind: 'first_aid_kit',
      name: 'First-aid kit',
      tag: 'FA-1',
      quantity: 1,
      home: 'Clubhouse',
      matchDay: true,
      holder: 'Priya Shah',
    },
    {
      kind: 'kicking_tees',
      name: 'Kicking tees',
      quantity: 3,
      home: 'Kit shed',
      matchDay: true,
      holder: 'Zara Khan',
    },
    { kind: 'flags', name: 'Corner flags', quantity: 8, home: 'Clubhouse', matchDay: true },
    {
      kind: 'contact_suits',
      name: 'Contact suit',
      tag: 'SUIT-1',
      quantity: 1,
      condition: 'needs_repair',
      home: 'Kit shed',
      notes: 'Zip broken',
    },
    { kind: 'scrum_machine', name: 'Scrum sled', quantity: 1, home: 'Pitch 2' },
  ];
  KIT.forEach((k, i) => {
    const itemId = id('ki');
    const created = now - (60 - i) * 86400e3;
    const holder = k.holder ? byName(k.holder) : null;
    const held = holder ? now - (3 + i) * 86400e3 : created;
    insert('inventory_items', {
      id: itemId,
      team_id: TEAM,
      kind: k.kind,
      name: k.name,
      tag: k.tag ?? null,
      quantity: k.quantity,
      condition: k.condition ?? 'good',
      status: holder ? 'with_someone' : 'available',
      holder_member_id: holder?.id ?? null,
      home: k.home,
      notes: k.notes ?? null,
      match_day: k.matchDay ? 1 : 0,
      version: 1,
      created_by: coach.userId,
      created_at: created,
      updated_at: held,
    });
    insert('inventory_events', {
      id: id('ke'),
      team_id: TEAM,
      item_id: itemId,
      kind: 'created',
      actor_member_id: coach.id,
      from_member_id: null,
      to_member_id: null,
      note: null,
      at: created,
    });
    if (holder)
      insert('inventory_events', {
        id: id('ke'),
        team_id: TEAM,
        item_id: itemId,
        kind: 'assigned',
        actor_member_id: coach.id,
        from_member_id: null,
        to_member_id: holder.id,
        note: null,
        at: held,
      });
    if (k.name === 'Red bibs') {
      // Megan is handing the bibs to Hannah for Thursday; Hannah hasn't answered yet.
      const to = byName('Hannah Price');
      const at = now - 5 * 3600e3;
      insert('inventory_handoffs', {
        id: id('kh'),
        team_id: TEAM,
        item_id: itemId,
        from_member_id: holder!.id,
        to_member_id: to.id,
        note: 'Washed, can you bring them Thursday?',
        created_at: at,
        expires_at: at + INVENTORY_HANDOFF_TTL_MS,
        resolved_at: null,
        outcome: null,
        updated_at: at,
      });
      insert('inventory_events', {
        id: id('ke'),
        team_id: TEAM,
        item_id: itemId,
        kind: 'handoff_requested',
        actor_member_id: holder!.id,
        from_member_id: holder!.id,
        to_member_id: to.id,
        note: 'Washed, can you bring them Thursday?',
        at,
      });
    }
  });

  if (owner.userId !== DEMO_USER_ID) throw new Error('demo owner id drifted');
  return tables;
}
// ---------------------------------------------------------------------------------------------
// Demo plays. Attack runs towards y = 0 (docs/diagrams.md §Model); "behind" the attack is larger
// y, and a team facing −y has its left at low x. Every pass goes sideways or back.

type Pos = Record<string, Vec2>;
type MoveSpec = Vec2 | { to: Vec2; ctrl?: Vec2[]; kind?: Move['kind']; delay?: number };
type Step = {
  caption: string;
  ms: number;
  moves?: Record<string, MoveSpec>;
  /** Ball state at the end of the step, and how it gets there. */
  ball?: Frame['ball'];
  ballMove?: { kind: Move['kind']; delay?: number; ctrl?: Vec2[] };
};
type Shape = { entities: Entity[]; pos: Pos; ball?: Frame['ball']; view: View };

/** A play from a starting shape plus steps that list only what moves. */
function framesPlay(
  pid: string,
  title: string,
  shape: Shape,
  caption0: string,
  steps: Step[],
  viewport?: Viewport,
): Play {
  const frames: Frame[] = [
    {
      id: 'f0',
      durationMs: 0,
      pos: structuredClone(shape.pos),
      moves: {},
      caption: caption0,
    },
  ];
  if (shape.ball) frames[0]!.ball = shape.ball;
  steps.forEach((s, i) => {
    const pos: Pos = {};
    const moves: Frame['moves'] = {};
    for (const [eid, spec] of Object.entries(s.moves ?? {})) {
      const m = 'x' in spec ? { to: spec } : spec;
      pos[eid] = m.to;
      const mv: Move = { kind: m.kind ?? 'run' };
      if (m.ctrl) mv.ctrl = m.ctrl;
      if (m.delay) mv.delayMs = m.delay;
      moves[eid] = mv;
    }
    if (s.ballMove) {
      const mv: Move = { kind: s.ballMove.kind };
      if (s.ballMove.delay) mv.delayMs = s.ballMove.delay;
      if (s.ballMove.ctrl) mv.ctrl = s.ballMove.ctrl;
      moves.ball = mv;
    }
    const f: Frame = {
      id: `f${i + 1}`,
      durationMs: s.ms,
      pos,
      moves,
      caption: s.caption,
    };
    if (s.ball) f.ball = s.ball;
    frames.push(f);
  });
  const play: Play = {
    v: 1,
    id: pid,
    mode: 'play',
    title,
    format: '15s',
    view: shape.view,
    entities: shape.entities,
    frames,
  };
  if (viewport) play.viewport = viewport;
  return play;
}

/** Move a group of tokens by (dx, dy) from where they are in `pos`. */
const shift = (pos: Pos, ids: string[], dx: number, dy: number): Pos =>
  Object.fromEntries(
    ids.map((k) => [k, { x: (pos[k] as Vec2).x + dx, y: (pos[k] as Vec2).y + dy }]),
  );

type Tok = [id: string, x: number, y: number, text?: string];
/** A shape from explicit tokens: `a{n}` attackers, `d{n}` defenders, numbered from the id. */
function tokens(
  view: View,
  list: Tok[],
  holder: string,
  labels: [string, number, number][] = [],
): Shape {
  const entities: Entity[] = [];
  const pos: Pos = {};
  for (const [eid, x, y, text] of list) {
    const e: Entity = {
      id: eid,
      kind: eid.startsWith('a') ? 'attack' : 'defence',
      number: Number(eid.slice(1)),
    };
    if (text) e.text = text;
    entities.push(e);
    pos[eid] = { x, y };
  }
  labels.forEach(([text, x, y], i) => {
    const lid = `label${i + 1}`;
    entities.push({ id: lid, kind: 'label', text });
    pos[lid] = { x, y };
  });
  entities.push({ id: 'ball', kind: 'ball' });
  pos.ball = { ...(pos[holder] as Vec2) };
  return { entities, pos, ball: { holder }, view };
}

/** Lineout plays show the backs 10 m+ back, beyond the named lineout view. */
const LINEOUT_VIEWPORT: Viewport = { x: -4, y: 24, w: 56, h: 46 };

/** The strike moves happen between their 22 and try line, right of the ruck. */
const STRIKE_VIEWPORT: Viewport = { x: 12, y: -6, w: 50, h: 48 };

/** Off a ruck at (20, 30) on the left, near their 22: shared by the two strike moves. */
const strikeShape = (): Shape =>
  tokens(
    'half',
    [
      ['a9', 20, 30.8],
      ['a10', 26, 34],
      ['a12', 32, 35.5],
      ['a13', 39, 37],
      ['a15', 45, 38.5],
      ['a14', 55, 40],
      ['d7', 23.5, 28.5],
      ['d10', 27, 28],
      ['d12', 33, 28],
      ['d13', 40, 28],
      ['d11', 50, 27],
      ['d15', 45, 15],
    ],
    'a9',
    [['Ruck', 18.6, 29.2]],
  );

type DemoPlay = {
  title: string;
  category: string;
  description: string;
  build: (pid: string) => Play;
};

const DEMO_PLAYS: DemoPlay[] = [
  {
    title: 'Lineout 5: front ball, maul',
    category: 'lineout',
    description: 'Front ball to position 2, set the maul.',
    build: (pid) => {
      const s = lineout(5);
      const maul = { a4: { x: 7.5, y: 41.5 }, a1: { x: 6.5, y: 42.3 } };
      const set: Pos = {
        ...maul,
        a3: { x: 8.5, y: 42.3 },
        a5: { x: 7.5, y: 43.2 },
        a6: { x: 6.5, y: 43.8 },
      };
      return framesPlay(
        pid,
        'Lineout 5: front ball, maul',
        s,
        '5-player lineout. Call: front ball to the 4 at position 2.',
        [
          {
            caption: 'Hooker throws to the front jumper; 1 and 3 lift.',
            ms: 1000,
            ball: { holder: 'a4' },
            ballMove: { kind: 'pass', delay: 150 },
          },
          {
            caption:
              '4 lands and turns to face her own team. 1, 3 and 5 bind on; the ball goes to the back.',
            ms: 1200,
            moves: set,
            ball: { holder: 'a5' },
            ballMove: { kind: 'pass', delay: 700 },
          },
          {
            caption:
              'The maul drives infield and forward, toward the try line. 2 joins at the back; 9 follows the ball.',
            ms: 1500,
            moves: {
              ...shift(set, Object.keys(set), 2, -4),
              a2: { x: 9.6, y: 40.6 },
              a9: { x: 11.4, y: 41.4 },
            },
          },
        ],
        LINEOUT_VIEWPORT,
      );
    },
  },
  {
    title: 'Lineout 7: back peel',
    category: 'lineout',
    description: 'Throw to the back; the 8 taps down to the 7 peeling round the tail.',
    build: (pid) =>
      framesPlay(
        pid,
        'Lineout 7: back peel',
        lineout(7),
        'Full lineout. Call: back ball to the 8 at position 6.',
        [
          {
            caption: '2 throws to the 8 at the back; 6 and 7 lift. The throw lands about 12 m in.',
            ms: 1100,
            ball: { holder: 'a8' },
            ballMove: { kind: 'pass', delay: 150 },
          },
          {
            caption: '8 taps the ball down to the 7 peeling round the tail.',
            ms: 1000,
            moves: {
              a7: { to: { x: 16.5, y: 42 }, ctrl: [{ x: 16.5, y: 41 }] },
            },
            ball: { holder: 'a7' },
            ballMove: { kind: 'pass', delay: 600 },
          },
          {
            caption:
              '7 carries flat off the tail at the opposition 10–12 channel; 9 and 6 support.',
            ms: 1300,
            moves: {
              a7: { to: { x: 20, y: 36 }, kind: 'carry' },
              a9: { x: 18, y: 40 },
              a6: { x: 17, y: 39 },
            },
          },
        ],
        LINEOUT_VIEWPORT,
      ),
  },
  {
    title: 'Scrum: 8 pick, 9 switch',
    category: 'scrum',
    description: 'The 8 picks right, the 9 loops round, and the 14 switches back against the flow.',
    build: (pid) =>
      framesPlay(
        pid,
        'Scrum: 8 pick, 9 switch',
        scrum15(),
        'Scrum in midfield. 9 feeds on the loosehead side; the pack hooks the ball back to the 8’s feet.',
        [
          {
            caption: '9 feeds, the hooker strikes and the ball is channelled back to the 8.',
            ms: 900,
            ball: { at: { x: 35, y: 42.8 } },
            ballMove: { kind: 'run', delay: 150, ctrl: [{ x: 34.6, y: 40.6 }] },
          },
          {
            caption: '8 picks from the base and goes right.',
            ms: 1200,
            moves: {
              a8: { to: { x: 38, y: 41 }, kind: 'carry' },
              d6: { x: 39.8, y: 38.4 },
              d9: {
                to: { x: 38.4, y: 37.4 },
                ctrl: [
                  { x: 33, y: 35.4 },
                  { x: 37, y: 35.4 },
                ],
              },
            },
            ball: { holder: 'a8' },
            ballMove: { kind: 'run' },
          },
          {
            caption: '8 passes back to the 9, who loops round behind; the right wing starts in.',
            ms: 1600,
            moves: {
              a8: { to: { x: 38.6, y: 40.4 }, kind: 'carry' },
              a9: {
                to: { x: 39, y: 42.5 },
                ctrl: [
                  { x: 33, y: 46.5 },
                  { x: 37, y: 46.5 },
                ],
              },
              a14: { x: 48, y: 47 },
              d9: { x: 39.6, y: 38.2 },
              d6: { x: 42, y: 38.6 },
            },
            ball: { holder: 'a9' },
            ballMove: { kind: 'pass', delay: 800 },
          },
          {
            caption: '9 switches with the openside wing, coming back against the flow.',
            ms: 1300,
            moves: {
              a9: { to: { x: 42.5, y: 41.4 }, kind: 'carry' },
              a14: { to: { x: 41.4, y: 42.8 }, ctrl: [{ x: 44.5, y: 46 }] },
              d9: { x: 43.5, y: 39 },
              d6: { x: 46, y: 38.8 },
              d10: { x: 31, y: 31 },
            },
            ball: { holder: 'a14' },
            ballMove: { kind: 'pass', delay: 1000 },
          },
          {
            caption: '14 breaks through the hole behind the drifting defense.',
            ms: 1900,
            moves: {
              a14: { to: { x: 38.5, y: 30 }, kind: 'carry' },
              d10: { x: 33.5, y: 31.8 },
            },
          },
        ],
      ),
  },
  {
    title: 'Strike: Wide Wally',
    category: 'strike',
    description: 'Miss pass from 10 to 13; the 14 comes in off the wing to hit the hole.',
    build: (pid) =>
      framesPlay(
        pid,
        'Strike: Wide Wally',
        strikeShape(),
        'Ruck on the left near their 22. Wide Wally: a miss pass from 10 to 13, and the 14 comes in off the wing.',
        [
          {
            caption: '9 to 10.',
            ms: 900,
            moves: { a10: { x: 26.4, y: 33.4 } },
            ball: { holder: 'a10' },
            ballMove: { kind: 'pass', delay: 100 },
          },
          {
            caption: '10 throws a miss pass over 12 to 13; 12 runs a decoy line.',
            ms: 1200,
            moves: {
              a10: { to: { x: 27, y: 32.5 }, kind: 'carry' },
              a12: { x: 33, y: 31 },
              a13: { x: 39.5, y: 35 },
              a15: { x: 45.5, y: 37 },
              a14: { x: 54, y: 38.5 },
              d10: { x: 27.4, y: 29.6 },
              d12: { x: 33, y: 29.8 },
              d13: { x: 40, y: 29.8 },
              d11: { x: 50, y: 28.5 },
            },
            ball: { holder: 'a13' },
            ballMove: { kind: 'pass', delay: 800 },
          },
          {
            caption:
              '13 fixes her defender; the 14 comes in off the wing into the hole between 13 and the outside defender.',
            ms: 1300,
            moves: {
              a13: { to: { x: 40.4, y: 32.6 }, kind: 'carry' },
              a14: { to: { x: 45.2, y: 33.8 }, ctrl: [{ x: 51, y: 37 }] },
              a15: { x: 48, y: 33.5 },
              d13: { x: 40.3, y: 31 },
              d11: { x: 49, y: 30.5 },
              d15: { x: 47, y: 20 },
            },
            ball: { holder: 'a14' },
            ballMove: { kind: 'pass', delay: 1000 },
          },
          {
            caption: '14 runs in to score.',
            ms: 4600,
            moves: {
              a14: {
                to: { x: 42.5, y: 1 },
                ctrl: [{ x: 44.5, y: 16 }],
                kind: 'carry',
              },
              a15: { x: 49, y: 18 },
              d15: { x: 46.5, y: 9 },
              d11: { x: 47.5, y: 24 },
            },
          },
        ],
        STRIKE_VIEWPORT,
      ),
  },
  {
    title: 'Strike: Unders',
    category: 'strike',
    description: '12 runs an unders line back inside 10.',
    build: (pid) =>
      framesPlay(
        pid,
        'Strike: Unders',
        strikeShape(),
        'Ruck on the left near their 22. Unders: 10 runs at the line and 12 cuts back inside her shoulder.',
        [
          {
            caption: '9 to 10.',
            ms: 900,
            moves: { a10: { x: 26.3, y: 33.4 } },
            ball: { holder: 'a10' },
            ballMove: { kind: 'pass', delay: 100 },
          },
          {
            caption: '10 runs hard at the line to hold the 10 defender.',
            ms: 1100,
            moves: {
              a10: { to: { x: 28.8, y: 30.8 }, kind: 'carry' },
              a12: { x: 30.5, y: 33.5 },
              a13: { x: 38, y: 34.5 },
              d10: { x: 29, y: 29.1 },
              d12: { x: 33.5, y: 29.3 },
              d13: { x: 40, y: 29.5 },
              d7: { x: 24, y: 28.8 },
            },
          },
          {
            caption:
              '12 cuts back on an unders line inside 10’s shoulder; 10 pops the pass just before contact.',
            ms: 900,
            moves: {
              a10: { to: { x: 29.1, y: 30.3 }, kind: 'carry' },
              a12: { to: { x: 27.6, y: 32 }, ctrl: [{ x: 29.8, y: 34 }] },
              d10: { x: 29.3, y: 29 },
              d12: { x: 33.6, y: 29.6 },
            },
            ball: { holder: 'a12' },
            ballMove: { kind: 'pass', delay: 650 },
          },
          {
            caption: '12 hits the gap between the pillar and the 10 defender.',
            ms: 1100,
            moves: {
              a12: { to: { x: 26.2, y: 24 }, kind: 'carry' },
              d10: { x: 28.8, y: 28.2 },
              d7: { x: 24.2, y: 27.9 },
            },
          },
        ],
        STRIKE_VIEWPORT,
      ),
  },
  {
    title: 'Kick-off: left short',
    category: 'kickoff',
    description:
      'Short, high kick-off to just past their 10 m line on the left, for our pod to contest.',
    build: (pid) => {
      const s = tokens(
        'full',
        [
          ['a10', 35, 50.5],
          ['a11', 5, 53],
          ['a1', 9, 53, 'L'],
          ['a4', 13, 53, 'J'],
          ['a3', 17, 53, 'L'],
          ['a6', 22, 53],
          ['a7', 27, 53],
          ['a2', 40, 53],
          ['a5', 45, 53],
          ['a8', 50, 53],
          ['a12', 55, 53],
          ['a13', 60, 53],
          ['a14', 65, 53],
          ['a9', 35, 56],
          ['a15', 35, 72],
          ['d1', 58, 37, 'L'],
          ['d4', 56, 37, 'J'],
          ['d3', 54, 37, 'L'],
          ['d6', 16, 37, 'L'],
          ['d5', 14, 37, 'J'],
          ['d7', 12, 37, 'L'],
          ['d2', 40, 34],
          ['d8', 30, 34],
          ['d9', 35, 30],
          ['d10', 42, 26],
          ['d12', 48, 22],
          ['d13', 22, 22],
          ['d11', 60, 15],
          ['d14', 10, 15],
          ['d15', 35, 10],
        ],
        'a10',
      );
      return framesPlay(
        pid,
        'Kick-off: left short',
        s,
        'Kicking team loaded left: six chasers between 5 and 27 m from the left touchline, all behind the ball. 4 jumps; 1 and 3 lift.',
        [
          {
            caption:
              '10 drop-kicks a short, high ball to land just past their 10 m line, 10 m in from the left touchline. Chasers go on the kick.',
            ms: 2800,
            moves: {
              a11: { to: { x: 5.5, y: 41.5 }, delay: 300 },
              a1: { to: { x: 9.3, y: 40.6 }, delay: 300 },
              a4: { to: { x: 10.6, y: 39.8 }, delay: 300 },
              a3: { to: { x: 11.9, y: 40.6 }, delay: 300 },
              a6: { to: { x: 15.5, y: 42.5 }, delay: 300 },
              a7: { to: { x: 20, y: 43.5 }, delay: 300 },
              a2: { to: { x: 37, y: 44 }, delay: 300 },
              a5: { to: { x: 43, y: 45 }, delay: 300 },
              a8: { to: { x: 48, y: 45.5 }, delay: 300 },
              a12: { to: { x: 53, y: 46 }, delay: 300 },
              a13: { to: { x: 58, y: 46.5 }, delay: 300 },
              a14: { to: { x: 63, y: 47 }, delay: 300 },
              a9: { to: { x: 28, y: 48 }, delay: 300 },
              a10: { to: { x: 31, y: 47.5 }, delay: 300 },
              a15: { to: { x: 33, y: 62 }, delay: 300 },
              d5: { x: 11.6, y: 38.3 },
              d6: { x: 12.8, y: 37.4 },
              d7: { x: 10.4, y: 37.4 },
              d8: { x: 20, y: 36 },
              d9: { x: 25, y: 32 },
              d13: { x: 16, y: 28 },
              d14: { x: 8, y: 26 },
            },
            ball: { at: { x: 10.6, y: 39.2 } },
            ballMove: { kind: 'kick', delay: 300 },
          },
          {
            caption:
              'Jumper 4, lifted by 1 and 3, competes for the ball in the air; the others chase to the landing zone.',
            ms: 900,
            moves: {
              a6: { x: 14.4, y: 41 },
              a7: { x: 17.6, y: 41.6 },
              a11: { x: 6.5, y: 39.6 },
            },
            ball: { holder: 'a4' },
            ballMove: { kind: 'carry' },
          },
        ],
        { x: -2, y: 4, w: 74, h: 72 },
      );
    },
  },
  {
    title: 'Exit: box kick',
    category: 'exit',
    description: 'Box kick from our 22 to a contestable spot.',
    build: (pid) => {
      const s = tokens(
        'full',
        [
          ['a9', 12, 86.5],
          ['a11', 5, 87.2],
          ['a13', 21, 88],
          ['a10', 18, 91],
          ['a12', 27, 90],
          ['a15', 35, 97],
          ['a14', 60, 90],
          ['d9', 12, 83.3],
          ['d7', 8.5, 82.5],
          ['d10', 20, 82.5],
          ['d12', 27, 82],
          ['d13', 34, 81.5],
          ['d14', 8, 54],
          ['d15', 30, 62],
          ['d11', 60, 66],
        ],
        'a9',
        [['Ruck', 15.6, 85.6]],
      );
      return framesPlay(
        pid,
        'Exit: box kick',
        s,
        'Ruck inside our 22, 12 m in from the left touchline. 9 to box-kick; 11 and 13 chase from behind the kicker.',
        [
          {
            caption:
              '9 box-kicks to land on our 10 m line, about 12 m in from touch. Chasers go on the kick.',
            ms: 3700,
            moves: {
              a11: { to: { x: 11, y: 61.5 }, delay: 300 },
              a13: { to: { x: 16, y: 67 }, delay: 300 },
              a10: { to: { x: 15.5, y: 74 }, delay: 400 },
              d14: { x: 12, y: 58.2 },
              d15: { x: 18, y: 60 },
            },
            ball: { at: { x: 12, y: 59.5 } },
            ballMove: { kind: 'kick', delay: 300 },
          },
          {
            caption:
              'Wing 11 competes for the ball, not the player; 13 and 10 follow to tackle once the catcher lands.',
            ms: 1000,
            moves: {
              a11: { x: 11.7, y: 60.3 },
              a13: { x: 14, y: 63.5 },
              a10: { x: 13.5, y: 69 },
            },
            ball: { holder: 'd14' },
            ballMove: { kind: 'carry' },
          },
          {
            caption:
              'The catcher lands; 13 tackles below the sternum while 11 competes for the ball.',
            ms: 900,
            moves: { a13: { x: 13.8, y: 59.2 } },
          },
        ],
        { x: -2, y: 46, w: 74, h: 64 },
      );
    },
  },
  {
    title: 'Defense: rush on 10',
    category: 'defence',
    description:
      'Rush (blitz) on the 10: 12 and 13 shoot up together on the 10/12, wing holds, 15 covers the kick.',
    build: (pid) => {
      const s = tokens(
        'half',
        [
          ['a9', 35, 41.6],
          ['a10', 42, 44.5],
          ['a12', 48.5, 45.8],
          ['a13', 55, 47],
          ['a15', 60.5, 48.5],
          ['a14', 66, 50],
          ['a7', 28, 43.8],
          ['a8', 21, 44.5],
          ['a11', 10, 47],
          ['d14', 7, 38],
          ['d7', 14, 38],
          ['d8', 20, 38],
          ['d6', 25.5, 38],
          ['d4', 28.5, 38],
          ['d2', 31, 38],
          ['d1', 33.4, 38],
          ['d3', 36.6, 38],
          ['d5', 39.6, 38],
          ['d10', 43.5, 38],
          ['d12', 49, 38],
          ['d13', 55, 38],
          ['d11', 61, 38],
          ['d9', 35, 33],
          ['d15', 58, 24],
        ],
        'a9',
        [['Ruck', 35, 40.1]],
      );
      return framesPlay(
        pid,
        'Defense: rush on 10',
        s,
        'Ruck in midfield, their backline going right. Guards tight; our 10, 12 and 13 opposite theirs. Call: rush.',
        [
          {
            caption:
              'On the 9’s pass, 12 and 13 accelerate up 4–5 m, inside-out; 10 goes with them.',
            ms: 900,
            moves: {
              a10: { x: 42.4, y: 43.8 },
              d10: { x: 43.2, y: 42 },
              d12: { x: 48.7, y: 43 },
              d13: { x: 54.6, y: 43 },
              d11: { x: 61, y: 40 },
              d5: { x: 39.8, y: 40 },
              d3: { x: 36.7, y: 39.2 },
              d15: { x: 59, y: 25 },
            },
            ball: { holder: 'a10' },
            ballMove: { kind: 'pass' },
          },
          {
            caption:
              '10 is pressured; 12 hits the 12, 13 takes the 13, and the 11 sits a step back for the kick or the miss pass.',
            ms: 1100,
            moves: {
              a10: { to: { x: 42.8, y: 43.2 }, kind: 'carry' },
              a12: { x: 48.6, y: 44.8 },
              a13: { x: 55, y: 46.2 },
              d10: { x: 43, y: 41.8 },
              d12: { x: 48.4, y: 43.5 },
              d13: { x: 54.8, y: 44.6 },
              d11: { x: 60.5, y: 41.5 },
              d15: { x: 60, y: 26 },
            },
            ball: { holder: 'a12' },
            ballMove: { kind: 'pass', delay: 300 },
          },
          {
            caption: '12 makes a dominant tackle behind the gain line, below the sternum.',
            ms: 900,
            moves: { a12: { x: 48.7, y: 45.4 }, d12: { x: 48.6, y: 44.4 } },
          },
        ],
        { x: -2, y: 18, w: 74, h: 38 },
      );
    },
  },
];
