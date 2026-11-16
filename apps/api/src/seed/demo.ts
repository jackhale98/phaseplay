/**
 * The demo team "Phaseplay RFC" (docs/testing-ci.md §Seed data), as plain rows per table.
 * Used by `pnpm db:seed` (local SQL) and by the Worker's public demo (refreshed daily so its dates
 * stay current). Deterministic ids; dates are relative to the current week. Fictional people only.
 */
import {
  zonedToUtc,
  addDays,
  dateInTz,
  type Play,
  type MatchPayload,
  type PlanData,
} from '@phaseplay/shared';
import { STARTER_DRILLS } from './starter-drills';
import { starterDiagram } from './starter-diagrams';

export const DEMO_TEAM_ID = 'a0000000-0000-7000-8000-000000000001';
/** The demo coach ("Sam Carter"). Has no passkey; the API refuses every write from this account. */
export const DEMO_USER_ID = 'b0000000-0000-7000-8000-000000000002';
/** Insert order respects foreign keys. */
export const DEMO_TABLE_ORDER = [
  'users',
  'teams',
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
] as const;
export type DemoTables = Record<(typeof DEMO_TABLE_ORDER)[number], Record<string, unknown>[]>;

export function buildDemo(now: number = Date.now()): DemoTables {
  const TZ = 'Europe/London';
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
    { name: 'Priya Shah', role: 'manager', positions: [] },
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
  for (const m of members) {
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

  // Plays (simple but valid diagrams; replaced by presets once packages/diagram lands).
  const mkPlay = (
    pid: string,
    title: string,
    view: Play['view'],
    tokens: {
      id: string;
      kind: 'attack' | 'defence' | 'ball';
      n?: number;
      a: [number, number];
      b: [number, number];
    }[],
    captions: [string, string],
  ): Play => ({
    v: 1,
    id: pid,
    mode: 'play',
    title,
    format: '15s',
    view,
    entities: tokens.map((t) => ({ id: t.id, kind: t.kind, ...(t.n ? { number: t.n } : {}) })),
    frames: [
      {
        id: 'f0',
        durationMs: 0,
        pos: Object.fromEntries(tokens.map((t) => [t.id, { x: t.a[0], y: t.a[1] }])),
        moves: {},
        caption: captions[0],
        ball: { holder: tokens.find((t) => t.kind === 'attack')?.id },
      },
      {
        id: 'f1',
        durationMs: 2200,
        pos: Object.fromEntries(tokens.map((t) => [t.id, { x: t.b[0], y: t.b[1] }])),
        moves: Object.fromEntries(
          tokens
            .filter((t) => t.kind !== 'ball')
            .map((t) => [t.id, { kind: 'run' as const, ease: 'inOut' as const }]),
        ),
        caption: captions[1],
      },
    ],
  });
  const playDefs: [string, string, Play['view'], string][] = [
    ['Lineout 5: front ball', 'lineout', 'lineout', 'Quick front ball to the 2, maul set.'],
    ['Lineout 7: back peel', 'lineout', 'lineout', 'Throw to the back, 8 peels round the tail.'],
    ['Scrum: 8 pick, 9 switch', 'scrum', 'scrum', 'Eight picks right, nine loops for the switch.'],
    ['Strike: Wide Wally', 'strike', 'attack22', 'Miss-pass from 10 to 13, winger hits the hole.'],
    ['Strike: Unders', 'strike', 'half', '12 runs the unders line off 10.'],
    ['Kick-off: left short', 'kickoff', 'half', 'Short kick to the 10 m on the left.'],
    ['Exit: box kick', 'exit', 'half', 'Box kick to touch from our 22.'],
    ['Defence: rush on 10', 'defence', 'half', 'Outside backs rush the 10 channel.'],
  ];
  for (const [title, category, view, description] of playDefs) {
    const pid = id('91a');
    const data = mkPlay(
      pid,
      title,
      view,
      [
        { id: 'a9', kind: 'attack', n: 9, a: [30, 60], b: [32, 64] },
        { id: 'a10', kind: 'attack', n: 10, a: [36, 66], b: [44, 72] },
        { id: 'a12', kind: 'attack', n: 12, a: [42, 70], b: [52, 78] },
        { id: 'a13', kind: 'attack', n: 13, a: [48, 73], b: [60, 82] },
        { id: 'd1', kind: 'defence', a: [36, 75], b: [40, 76] },
        { id: 'd2', kind: 'defence', a: [46, 78], b: [50, 79] },
      ],
      ['Set up', description],
    );
    insert('plays', {
      id: pid,
      team_id: TEAM,
      title,
      category,
      tags: JSON.stringify([category]),
      format: '15s',
      visibility: category === 'defence' ? 'coaches' : 'team',
      description,
      data: JSON.stringify(data),
      frame_count: data.frames.length,
      version: 1,
      created_by: owner.userId,
      created_at: now - 20 * 86400e3,
      updated_at: now - Math.floor(rand() * 20) * 86400e3,
    });
  }

  // Drills: the starter pack (12 shown in docs; we seed all 15).
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

  insert('audit_log', {
    id: id('ad'),
    team_id: TEAM,
    actor_id: owner.userId,
    action: 'team.created',
    target_type: 'team',
    target_id: TEAM,
    at: now - 90 * 86400e3,
  });
  if (owner.userId !== DEMO_USER_ID) throw new Error('demo owner id drifted');
  return tables;
}
