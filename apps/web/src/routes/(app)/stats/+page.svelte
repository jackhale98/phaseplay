<!--
  Season stats (PLAN.md M7): attendance, minutes, results and scoring, penalty trends and training
  load. Computed on the device from the snapshot plus the stats feed (docs/architecture.md §Season
  stats). Team totals, results and scoring are for everyone; other people's attendance and minutes
  need availability.view (staff and Captain-style roles).
-->
<script lang="ts">
  import { untrack } from 'svelte';
  import {
    OFFENCE_LABELS,
    RULES,
    currentSeason,
    dateInTz,
    heldEvents,
    isGame,
    loadByGroup,
    pct,
    seasonWindow,
    type AttendanceTally,
  } from '@phaseplay/shared';
  import { app } from '#lib/data/app.svelte';
  import { events, memberName } from '#lib/data/selectors';
  import { day as fmtDay, plural } from '#lib/format';
  import Loader from '#lib/components/Loader.svelte';
  import EmptyState from '#lib/components/EmptyState.svelte';
  import Button from '#lib/components/Button.svelte';
  import BarChart from '#lib/features/stats/BarChart.svelte';
  import { computeStats, mins } from '#lib/features/stats/compute';
  import { StatsSource } from '#lib/features/stats/source.svelte';
  import { IconChevronRight, IconInfo } from '#lib/icons';

  const s = $derived(app.snap);
  const tz = $derived(s?.team.timezone ?? 'UTC');
  const now = Date.now();
  const seasons = $derived(
    Object.values(s?.rows.seasons ?? {})
      .filter((x) => !x.deletedAt)
      .sort((a, b) => b.startsOn.localeCompare(a.startsOn)),
  );
  let pick = $state<string | null>(null);
  const key = $derived(pick ?? currentSeason(seasons, dateInTz(now, tz))?.id ?? 'all');
  const season = $derived(seasons.find((x) => x.id === key) ?? null);
  const win = $derived(season ? seasonWindow(season, tz) : null);
  const canAll = $derived(app.can('availability.view'));

  const src = new StatsSource();
  const gameIds = $derived(
    s
      ? heldEvents(events(s), win, now, tz)
          .filter((e) => isGame(e.type))
          .map((e) => e.id)
      : [],
  );
  const loadKey = $derived(`${s?.teamId ?? ''}|${key}|${gameIds.join(',')}`);
  $effect(() => {
    void loadKey;
    untrack(() => {
      if (s) void src.load(s.teamId, key, win, gameIds);
    });
  });

  const v = $derived(
    s
      ? computeStats(s, {
          win,
          now,
          feed: src.feed,
          extra: src.extra,
          local: src.local,
          canAll,
        })
      : null,
  );
  /** Names players' devices don't have (names not yet joined) read as a squad member. */
  const name = (id: string) => (s?.rows.members[id] ? memberName(s, id) : 'Squad member');
  const meId = $derived(s?.me.id ?? '');

  const status = $derived(
    src.status === 'live'
      ? 'Up to date'
      : src.status === 'loading'
        ? 'Fetching match logs…'
        : src.status === 'cached'
          ? 'Offline: showing stats saved on this device'
          : 'Offline: match logs and older attendance load when you’re back online',
  );

  const res = $derived(v?.tallies.results);
  const diff = $derived(res ? res.pointsFor - res.pointsAgainst : 0);
  const myLine = $derived(v?.attendance.lines.find((l) => l.memberId === meId));
  const myMinutes = $derived(v?.tallies.minutes.find((m) => m.memberId === meId));
  const loadWeeks = $derived(v?.load ?? []);
  const plannedWeeks = $derived(loadWeeks.filter((w) => w.planned > 0));
  const avgContact = $derived(
    plannedWeeks.length
      ? Math.round(plannedWeeks.reduce((n, w) => n + w.contactMin, 0) / plannedWeeks.length)
      : null,
  );
  const avgHigh = $derived(
    plannedWeeks.length
      ? Math.round(plannedWeeks.reduce((n, w) => n + w.highIntensityMin, 0) / plannedWeeks.length)
      : null,
  );
  const groupTotals = $derived(Object.entries(loadByGroup(loadWeeks)));
  const LANES: Record<string, string> = {
    all: 'Whole squad',
    forwards: 'Forwards',
    backs: 'Backs',
  };
  const weekLabel = (d: string) =>
    new Date(`${d}T12:00:00Z`).toLocaleDateString(undefined, {
      day: 'numeric',
      month: 'short',
      timeZone: 'UTC',
    });

  const recorded = $derived((v?.lines ?? []).filter((l) => l.recorded).reverse());
  const maxMs = $derived(Math.max(60e3, ...(v?.tallies.minutes ?? []).map((m) => m.ms)));
  const topOff = $derived(v?.penalties.top.slice(0, 6) ?? []);
  const maxOff = $derived(Math.max(1, ...topOff.map((o) => o.count)));
  const offLabel = (k: string) => OFFENCE_LABELS[k as keyof typeof OFFENCE_LABELS] ?? k;
  /** "v Opponent", or the event's title for a tournament day or a game with no opponent. */
  const vs = (id: string, o: string | null) =>
    o ? `v ${o}` : (s?.rows.events[id]?.title ?? 'Game');
  /** Long lists start short; "Show all" opens the rest. */
  const SHORT = 12;
  let allAtt = $state(false);
  let allMin = $state(false);
  const attLines = $derived(
    [...(v?.attendance.lines ?? [])].sort(
      (a, b) =>
        (pct(b.total) ?? -1) - (pct(a.total) ?? -1) ||
        name(a.memberId).localeCompare(name(b.memberId)),
    ),
  );
  const ratio = (t: AttendanceTally) => `${t.attended}/${t.held}`;
  const pc = (t: AttendanceTally) => {
    const p = pct(t);
    return p === null ? '–' : `${p}%`;
  };
  const RESULT = { W: 'Won', D: 'Drew', L: 'Lost' } as const;
  const shortDay = (ms: number) =>
    new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', timeZone: tz }).format(ms);
</script>

<svelte:head><title>Season stats · Phaseplay</title></svelte:head>

<div class="page stats">
  <div class="page-head">
    <div>
      <h1>Season stats</h1>
      <p class="subtle" aria-live="polite">{s ? status : ''}</p>
    </div>
    {#if s}
      <div class="pick">
        <label for="season-pick">Season</label>
        <select id="season-pick" value={key} onchange={(e) => (pick = e.currentTarget.value)}>
          {#each seasons as x (x.id)}<option value={x.id}>{x.name}</option>{/each}
          <option value="all">All time</option>
        </select>
      </div>
    {/if}
  </div>

  {#if !s || !v || !res}
    <Loader label="Loading season stats" />
  {:else if !v.held.length}
    <EmptyState
      title="Nothing played yet"
      body={season
        ? `No practices or games have finished in ${season.name}. Stats build up as the season goes.`
        : 'No practices or games have finished yet. Stats build up as the season goes.'}
    >
      {#snippet action()}<Button href="/schedule" variant="primary">See the schedule</Button
        >{/snippet}
    </EmptyState>
  {:else}
    <p class="note">
      <IconInfo />
      <span>
        {#if v.formats['15s'] && v.formats['7s']}
          Includes 15s ({RULES['15s'].halfMinutes}-minute halves) and 7s ({RULES['7s']
            .halfMinutes}-minute halves, each tournament game counted).
        {:else if v.formats['7s']}
          7s: {RULES['7s'].halfMinutes}-minute halves, each tournament game counted.
        {:else}
          15s: {RULES['15s'].halfMinutes}-minute halves.
        {/if}
        Minutes and scores come from match mode; only recorded games count.
      </span>
    </p>

    {#if v.missing.size}
      <p class="hint" role="status">
        <IconInfo />
        <span
          >{v.missing.size === 1 ? '1 game’s' : `${v.missing.size} games’`} match logs didn’t load, so
          results, minutes and scorers leave {v.missing.size === 1 ? 'it' : 'them'} out for now. Pick
          a single season, or try again when you’re online.</span
        >
      </p>
    {/if}
    <ul class="list tiles" aria-label="Season at a glance">
      <li class="card tile">
        <span class="k">Record</span>
        <strong class="tnum big">{res.won}–{res.drawn}–{res.lost}</strong>
        <span class="subtle">W–D–L · {plural(res.played, 'game')}</span>
      </li>
      <li class="card tile">
        <span class="k">Points</span>
        <strong class="tnum big">{res.pointsFor}–{res.pointsAgainst}</strong>
        <span class="subtle tnum">{diff > 0 ? '+' : ''}{diff} difference</span>
      </li>
      <li class="card tile">
        <span class="k">{canAll ? 'Practices' : 'Your attendance'}</span>
        {#if canAll}
          <strong class="tnum big">{v.practicesHeld}</strong>
          <span class="subtle tnum"
            >{v.attendance.practices.avgPresent === null
              ? 'held'
              : `held · ${v.attendance.practices.avgPresent} there on average`}</span
          >
        {:else}
          <strong class="tnum big">{myLine ? pc(myLine.total) : '–'}</strong>
          <span class="subtle tnum"
            >{myLine ? `${ratio(myLine.total)} sessions and games` : ''}</span
          >
        {/if}
      </li>
      <li class="card tile">
        <span class="k">Contact a week</span>
        <strong class="tnum big">{avgContact === null ? '–' : `${avgContact}'`}</strong>
        <span class="subtle tnum"
          >{avgHigh === null ? 'no practice plans yet' : `${avgHigh}' high intensity`}</span
        >
      </li>
    </ul>

    <div class="cols">
      <section class="card sec" aria-labelledby="h-res">
        <h2 id="h-res">Results</h2>
        {#if v.lines.length}
          <ul class="list rows">
            {#each v.lines as l (l.eventId)}
              <li>
                <a href="/events/{l.eventId}/match/summary">
                  <span class="grow">
                    <strong>{vs(l.eventId, l.opponent)}</strong>
                    <small>{fmtDay(l.startsAt, tz)}{l.tournament ? ' · 7s tournament' : ''}</small>
                  </span>
                  {#if v.missing.has(l.eventId)}
                    <span class="subtle">Log not loaded</span>
                  {:else if !l.recorded}
                    <span class="subtle">Not recorded</span>
                  {:else}
                    <span class="games">
                      {#each l.games as g, i (i)}
                        <span class="score tnum">
                          <span class="res {g.result}"
                            >{g.result}<span class="sr-only">, {RESULT[g.result]}</span></span
                          >
                          {g.us}–{g.them}
                        </span>
                      {/each}
                    </span>
                  {/if}
                  <IconChevronRight />
                </a>
              </li>
            {/each}
          </ul>
        {:else}<p class="subtle">No games played yet.</p>{/if}
      </section>

      <section class="card sec" aria-labelledby="h-att">
        <h2 id="h-att">Attendance</h2>
        <dl class="team">
          <div>
            <dt>Practices</dt>
            <dd class="tnum">
              {v.attendance.practices.held} held{#if v.attendance.practices.avgPresent !== null}, {v
                  .attendance.practices.avgPresent} there on average{/if}
            </dd>
          </div>
          <div>
            <dt>Games</dt>
            <dd class="tnum">
              {plural(
                v.attendance.games.held,
                'fixture',
              )}{#if v.attendance.games.avgPresent !== null}, {v.attendance.games.avgPresent} there on
                average{/if}
            </dd>
          </div>
        </dl>
        {#if v.fromRsvp}
          <p class="hint">
            <IconInfo />
            <span
              >{plural(v.fromRsvp, 'session')} had no register taken, so an RSVP “yes” counts as there
              for {v.fromRsvp === 1 ? 'it' : 'those'}.</span
            >
          </p>
        {/if}
        {#if v.attendance.lines.length}
          <div class="tw">
            <table class="tt">
              <caption class="sr-only"
                >{canAll ? 'Attendance by player' : 'Your attendance'}: attended out of held</caption
              >
              <thead>
                <tr>
                  <th scope="col">{canAll ? 'Player' : 'You'}</th>
                  <th scope="col">Practices</th>
                  <th scope="col">Games</th>
                  <th scope="col">Overall</th>
                </tr>
              </thead>
              <tbody>
                {#each allAtt ? attLines : attLines.slice(0, SHORT) as l (l.memberId)}
                  <tr class:me={l.memberId === meId}>
                    <th scope="row">{name(l.memberId)}</th>
                    <td class="tnum">{ratio(l.practices)}</td>
                    <td class="tnum">{ratio(l.games)}</td>
                    <td class="tnum pct">
                      <span class="meter" aria-hidden="true"
                        ><span style:width="{pct(l.total) ?? 0}%"></span></span
                      >{pc(l.total)}
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
          {#if attLines.length > SHORT}
            <button
              class="more"
              type="button"
              aria-expanded={allAtt}
              onclick={() => (allAtt = !allAtt)}
              >{allAtt ? 'Show fewer' : `Show all ${attLines.length} players`}</button
            >
          {/if}
        {/if}
        {#if !canAll}<p class="subtle">
            Other players’ attendance is for coaches and captains.
          </p>{/if}
      </section>

      <section class="card sec" aria-labelledby="h-min">
        <h2 id="h-min">Minutes played</h2>
        <p class="subtle">
          From {plural(v.tallies.minutesFrom, 'recorded game')} with a team sheet, as in each match summary.
        </p>
        {#if !canAll}
          <p class="mine">
            <strong class="tnum big">{mins(myMinutes?.ms ?? 0)}</strong>
            <span class="muted"
              >for you{#if myMinutes}, in {plural(myMinutes.appearances, 'game')} ({plural(
                  myMinutes.starts,
                  'start',
                )}){/if}</span
            >
          </p>
        {/if}
        {#if v.tallies.minutes.length}
          <ul class="list bars">
            {#each allMin ? v.tallies.minutes : v.tallies.minutes.slice(0, SHORT) as m (m.memberId)}
              <li class:me={m.memberId === meId}>
                <span class="bl"
                  >{name(m.memberId)}<small
                    >{plural(m.appearances, 'game')} · {plural(m.starts, 'start')}</small
                  ></span
                >
                <span class="track" aria-hidden="true"
                  ><span class="fill" style:width="{(m.ms / maxMs) * 100}%"></span></span
                >
                <span class="tnum n">{mins(m.ms)}</span>
              </li>
            {/each}
          </ul>
          {#if v.tallies.minutes.length > SHORT}
            <button
              class="more"
              type="button"
              aria-expanded={allMin}
              onclick={() => (allMin = !allMin)}
              >{allMin ? 'Show fewer' : `Show all ${v.tallies.minutes.length} players`}</button
            >
          {/if}
        {:else}<p class="subtle">No minutes yet: record a game with a team sheet.</p>{/if}
      </section>

      <section class="card sec" aria-labelledby="h-sc">
        <h2 id="h-sc">Scoring and cards</h2>
        {#if v.tallies.scorers.length}
          <div class="tw">
            <table class="tt">
              <caption class="sr-only">Points, tries, kicks and cards by player</caption>
              <thead>
                <tr>
                  <th scope="col">Player</th>
                  <th scope="col"><abbr title="Tries">T</abbr></th>
                  <th scope="col"><abbr title="Conversions">C</abbr></th>
                  <th scope="col"><abbr title="Penalty goals">PG</abbr></th>
                  <th scope="col"><abbr title="Drop goals">DG</abbr></th>
                  <th scope="col"><abbr title="Points">Pts</abbr></th>
                  <th scope="col"><abbr title="Yellow and red cards">Cards</abbr></th>
                </tr>
              </thead>
              <tbody>
                {#each v.tallies.scorers as p (p.memberId)}
                  <tr class:me={p.memberId === meId}>
                    <th scope="row">{name(p.memberId)}</th>
                    <td class="tnum">{p.tries || ''}</td>
                    <td class="tnum">{p.conversions || ''}</td>
                    <td class="tnum">{p.penaltyGoals || ''}</td>
                    <td class="tnum">{p.dropGoals || ''}</td>
                    <td class="tnum"><strong>{p.points}</strong></td>
                    <td
                      ><span class="cards">
                        {#each { length: p.yellow } as _, i (i)}<span
                            class="cardsw"
                            title="Yellow card"
                          ></span>{/each}
                        {#each { length: p.red } as _, i (i)}<span
                            class="cardsw red"
                            title="Red card"
                          ></span>{/each}
                        {#if p.yellow || p.red}<span class="sr-only"
                            >{plural(p.yellow, 'yellow')}, {plural(p.red, 'red')}</span
                          >{/if}</span
                      ></td
                    >
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {:else}<p class="subtle">No named scorers or cards yet.</p>{/if}
        <p class="subtle tnum cardline">
          Cards: us {plural(v.tallies.cards.us.yellow, 'yellow')}, {plural(
            v.tallies.cards.us.red,
            'red',
          )}
          · opposition {plural(v.tallies.cards.them.yellow, 'yellow')}, {plural(
            v.tallies.cards.them.red,
            'red',
          )}
        </p>
      </section>

      <section class="card sec wide" aria-labelledby="h-pen">
        <h2 id="h-pen">Penalties conceded</h2>
        {#if recorded.length}
          <div class="split">
            <div>
              <h3 class="sub">Per game</h3>
              <BarChart
                categories={v.penalties.perMatch.map((m) => ({
                  label: shortDay(m.startsAt),
                  title: `${vs(m.eventId, m.opponent)}, ${fmtDay(m.startsAt, tz)}`,
                }))}
                series={[
                  {
                    key: 'against',
                    label: 'Conceded',
                    values: v.penalties.perMatch.map((m) => m.against),
                  },
                ]}
                ref={v.penalties.avgAgainst === null
                  ? null
                  : { value: v.penalties.avgAgainst, label: `Average ${v.penalties.avgAgainst}` }}
                summary="Penalties conceded per game. {v.penalties.against} in {plural(
                  recorded.length,
                  'game',
                )}, {v.penalties.avgAgainst} a game on average."
                caption="Penalties conceded per game"
                catHeading="Game"
              />
            </div>
            <div>
              <h3 class="sub">Top offences</h3>
              {#if topOff.length}
                <ul class="list bars">
                  {#each topOff as o (o.offence)}
                    <li>
                      <span class="bl">{offLabel(o.offence)}</span>
                      <span class="track" aria-hidden="true"
                        ><span class="fill" style:width="{(o.count / maxOff) * 100}%"></span></span
                      >
                      <span class="tnum n">{o.count}</span>
                    </li>
                  {/each}
                </ul>
              {:else}<p class="subtle">No penalties conceded. Lovely discipline.</p>{/if}
            </div>
          </div>
        {:else}<p class="subtle">Record a game in match mode to see penalty trends.</p>{/if}
      </section>

      <section class="card sec wide" aria-labelledby="h-load">
        <h2 id="h-load">Training load</h2>
        <p class="subtle">
          Team minutes from practice plans: contact means shields or full contact, high intensity is
          a drill rated 4 or 5. Split sessions count for each group.
        </p>
        {#if plannedWeeks.length}
          <BarChart
            categories={loadWeeks.map((w) => ({
              label: weekLabel(w.week),
              title: `Week of ${weekLabel(w.week)} · ${plural(w.sessions, 'practice')}${w.planned < w.sessions ? `, ${w.planned} planned` : ''}`,
            }))}
            series={[
              { key: 'contact', label: 'Contact', values: loadWeeks.map((w) => w.contactMin) },
              {
                key: 'high',
                label: 'High intensity',
                values: loadWeeks.map((w) => w.highIntensityMin),
              },
            ]}
            unit="'"
            summary="Contact and high-intensity minutes per week, about {avgContact} and {avgHigh} minutes a week."
            caption="Training load per week, in minutes"
            catHeading="Week"
          />
          {#if groupTotals.length > 1}
            <h3 class="sub">By group</h3>
            <div class="tw">
              <table class="tt">
                <caption class="sr-only">Training minutes by group across the season</caption>
                <thead>
                  <tr>
                    <th scope="col">Group</th>
                    <th scope="col">Contact</th>
                    <th scope="col">High intensity</th>
                    <th scope="col">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {#each groupTotals as [lane, g] (lane)}
                    <tr>
                      <th scope="row">{LANES[lane] ?? lane}</th>
                      <td class="tnum">{g.contactMin}'</td>
                      <td class="tnum">{g.highIntensityMin}'</td>
                      <td class="tnum">{g.totalMin}'</td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
          {/if}
        {:else}
          <p class="subtle">Attach a practice plan to a practice and its load shows up here.</p>
        {/if}
      </section>
    </div>
  {/if}
</div>

<style>
  .stats {
    --viz-1: #2a78d6;
    --viz-2: #eb6834;
  }
  @media (prefers-color-scheme: dark) {
    :global(:root:not([data-theme='light'])) .stats {
      --viz-1: #3987e5;
      --viz-2: #d95926;
    }
  }
  :global(:root[data-theme='dark']) .stats {
    --viz-1: #3987e5;
    --viz-2: #d95926;
  }
  .page-head p {
    margin-top: var(--s-1);
  }
  .pick {
    display: flex;
    flex-direction: column;
    gap: var(--s-1);
    font-size: var(--t-12);
    font-weight: 650;
    color: var(--text-2);
  }
  .pick select {
    min-height: 44px;
    min-width: 160px;
    padding: 0 var(--s-3);
    border: 1px solid var(--border-strong);
    border-radius: var(--r-md);
    background: var(--surface);
    color: var(--text);
    font: inherit;
    font-size: var(--t-16);
    font-weight: 600;
  }
  .note,
  .hint {
    display: flex;
    gap: var(--s-2);
    align-items: flex-start;
    margin: 0 0 var(--s-4);
    font-size: var(--t-14);
    color: var(--text-2);
  }
  .note :global(svg),
  .hint :global(svg) {
    flex: none;
    width: 16px;
    height: 16px;
    margin-top: 2px;
  }
  .tiles {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--s-3);
    margin-bottom: var(--s-4);
  }
  @media (min-width: 900px) {
    .tiles {
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }
  }
  .tile {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: var(--s-3) var(--s-4);
    min-width: 0;
  }
  .k {
    font-size: var(--t-12);
    font-weight: 700;
    color: var(--text-2);
  }
  .big {
    font-size: var(--t-24);
    font-weight: 800;
    line-height: 1.2;
  }
  .cols {
    display: grid;
    align-items: start;
    gap: var(--s-4);
  }
  @media (min-width: 900px) {
    .cols {
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    }
    .wide {
      grid-column: 1 / -1;
    }
    .split {
      display: grid;
      grid-template-columns: minmax(0, 3fr) minmax(0, 2fr);
      gap: var(--s-6);
    }
  }
  .sec {
    padding: var(--s-4) var(--s-5);
    min-width: 0;
  }
  .sec h2 {
    font-size: var(--t-16);
    margin-bottom: var(--s-3);
  }
  .sec > .subtle {
    margin-bottom: var(--s-3);
  }
  .sub {
    margin: var(--s-3) 0 var(--s-2);
    font-size: var(--t-14);
    color: var(--text-2);
  }
  .rows li a {
    display: flex;
    align-items: center;
    gap: var(--s-3);
    min-height: 52px;
    padding: var(--s-1) 0;
    border-bottom: 1px solid var(--border);
    color: var(--text);
    text-decoration: none;
  }
  .rows li:last-child a {
    border-bottom: 0;
  }
  .rows a:hover strong {
    text-decoration: underline;
  }
  .rows small {
    display: block;
    color: var(--text-2);
    font-size: var(--t-12);
  }
  .rows :global(svg) {
    flex: none;
    width: 18px;
    height: 18px;
    color: var(--text-3);
  }
  .games {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: var(--s-1) var(--s-3);
  }
  .score {
    display: inline-flex;
    align-items: center;
    gap: var(--s-2);
    font-weight: 700;
  }
  .res {
    display: inline-grid;
    place-items: center;
    min-width: 24px;
    height: 24px;
    border-radius: var(--r-sm);
    background: var(--surface-3);
    color: var(--text);
    font-size: var(--t-12);
    font-weight: 800;
  }
  .res.W {
    background: var(--ok-soft);
    color: color-mix(in srgb, var(--ok) 72%, var(--text));
  }
  .res.L {
    background: var(--danger-soft);
    color: var(--danger);
  }
  .team {
    display: grid;
    gap: var(--s-1);
    margin: 0 0 var(--s-3);
  }
  .team div {
    display: flex;
    gap: var(--s-2);
  }
  .team dt {
    font-weight: 700;
    min-width: 80px;
  }
  .team dd {
    margin: 0;
    color: var(--text-2);
  }
  .tw {
    overflow-x: auto;
  }
  .tt {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--t-14);
  }
  .tt th,
  .tt td {
    padding: var(--s-2) var(--s-2);
    border-bottom: 1px solid var(--border);
    text-align: right;
    white-space: nowrap;
  }
  .tt th:first-child {
    text-align: left;
    padding-left: 0;
    white-space: normal;
  }
  .tt thead th {
    color: var(--text-2);
    font-size: var(--t-12);
    font-weight: 700;
  }
  .tt tbody th {
    font-weight: 600;
  }
  .tt abbr {
    text-decoration: none;
  }
  tr.me th,
  li.me .bl {
    color: var(--accent-text);
  }
  .pct {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: var(--s-2);
  }
  .meter {
    display: inline-block;
    width: 48px;
    height: 8px;
    border-radius: 4px;
    background: var(--surface-3);
    overflow: hidden;
  }
  .meter span {
    display: block;
    height: 100%;
    background: var(--viz-1);
    border-radius: 0 4px 4px 0;
  }
  @media (max-width: 420px) {
    .meter {
      display: none;
    }
  }
  .bars li {
    display: grid;
    grid-template-columns: minmax(120px, 40%) 1fr 40px;
    align-items: center;
    gap: var(--s-2);
    min-height: 40px;
    font-size: var(--t-14);
  }
  .bl {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 600;
  }
  .bl small {
    display: block;
    font-weight: 500;
    font-size: var(--t-12);
    color: var(--text-2);
  }
  .track {
    height: 10px;
    border-radius: 0 4px 4px 0;
    background: var(--surface-2);
    overflow: hidden;
  }
  .fill {
    display: block;
    height: 100%;
    border-radius: 0 4px 4px 0;
    background: var(--viz-1);
  }
  .n {
    text-align: right;
    font-weight: 750;
  }
  .mine {
    display: flex;
    align-items: baseline;
    flex-wrap: wrap;
    gap: var(--s-2);
    margin-bottom: var(--s-2);
  }
  .cards {
    display: inline-flex;
    justify-content: flex-end;
    gap: 3px;
  }
  .cardsw {
    display: inline-block;
    width: 10px;
    height: 14px;
    border-radius: 2px;
    background: #f5c518;
    border: 1px solid color-mix(in srgb, #000 35%, #f5c518);
  }
  .cardsw.red {
    background: #d92d20;
    border-color: color-mix(in srgb, #000 35%, #d92d20);
  }
  .more {
    min-height: 44px;
    margin-top: var(--s-2);
    padding: 0;
    border: 0;
    background: none;
    color: var(--accent-text);
    font: inherit;
    font-weight: 650;
  }
  .more:hover {
    text-decoration: underline;
  }
  .cardline {
    margin-top: var(--s-3);
  }
</style>
