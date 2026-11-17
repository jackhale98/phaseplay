<!-- Post-match summary (PLAN.md M6 §Afterwards). Everyone in the team can read the log. -->
<script lang="ts">
  import { onMount } from 'svelte';
  import {
    formatClock,
    isGame,
    OFFENCE_LABELS,
    pointsFor,
    SCORE_LABELS,
    STOPPAGE_LABELS,
    type MatchEvent,
    type ScoreType,
  } from '@phaseplay/shared';
  import { app } from '#lib/data/app.svelte';
  import { memberName } from '#lib/data/selectors';
  import { day as fmtDay } from '#lib/format';
  import { shareOrDownload, copyImage } from '#lib/share';
  import { toasts } from '#lib/stores/toast.svelte';
  import Button from '#lib/components/Button.svelte';
  import Sheet from '#lib/components/Sheet.svelte';
  import { loadCrest } from '#lib/crest';
  import EmptyState from '#lib/components/EmptyState.svelte';
  import Segmented from '#lib/components/Segmented.svelte';
  import { IconBack, IconShare, IconCopy, IconMatch, IconPlay } from '#lib/icons';
  import { MatchView } from './view.svelte';
  import { minuteOf } from './log';
  import ProgressionChart from './ProgressionChart.svelte';
  import MiniPitch from './MiniPitch.svelte';
  import Timeline from './Timeline.svelte';

  let { eventId }: { eventId: string } = $props();
  // svelte-ignore state_referenced_locally
  const v = new MatchView(eventId);
  onMount(() => v.mount());

  let pick = $state<string>('');
  $effect(() => {
    if (v.session.loaded && v.tournament && !pick) pick = String(v.day.length);
  });
  const gameNo = $derived(v.tournament ? Number(pick || v.day.length) : null);
  const g = $derived(v.game(gameNo));
  const s = $derived(g.state);
  const offset = $derived(g.offset);
  const snap = $derived(v.snap);
  const event = $derived(v.event);
  const staff = $derived(app.can('match.record'));
  const name = (id: string | null | undefined) => (id ? memberName(snap, id) : 'Unnamed');

  const result = $derived(
    s.score.us > s.score.them ? 'Win' : s.score.us < s.score.them ? 'Loss' : 'Draw',
  );
  const scoring = $derived(
    s.log.filter(
      (
        e,
      ): e is MatchEvent & {
        payload: { kind: 'score'; team: 'us' | 'them'; type: ScoreType; playerId?: string | null };
      } => e.payload.kind === 'score',
    ),
  );
  const SHORT: Record<ScoreType, string> = {
    try: 'Try',
    conversion: 'Con',
    conversion_miss: 'Con missed',
    penalty_goal: 'Pen',
    penalty_goal_miss: 'Pen missed',
    drop_goal: 'DG',
    penalty_try: 'Pen try',
  };
  const scorers = $derived.by(() => {
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- local to this derived
    const rows = new Map<
      string,
      { team: 'us' | 'them'; name: string; pts: number; items: string[] }
    >();
    for (const e of scoring) {
      const p = e.payload;
      const key = p.team === 'them' ? 'them' : (p.playerId ?? 'us-unnamed');
      const row = rows.get(key) ?? {
        team: p.team,
        name: p.team === 'them' ? v.opponent : p.playerId ? name(p.playerId) : `${v.us} (unnamed)`,
        pts: 0,
        items: [],
      };
      row.pts += pointsFor(p.type, v.cfg.points);
      row.items.push(`${SHORT[p.type]} ${minuteOf(e.gameMs - offset)}'`);
      rows.set(key, row);
    }
    return [...rows.values()].sort((a, b) =>
      a.team === b.team ? b.pts - a.pts : a.team === 'us' ? -1 : 1,
    );
  });
  const cards = $derived(
    s.log.flatMap((e) =>
      e.payload.kind === 'card'
        ? [
            {
              e,
              team: e.payload.team,
              colour: e.payload.colour,
              who: e.payload.team === 'us' ? name(e.payload.playerId) : v.opponent,
            },
          ]
        : [],
    ),
  );
  const pens = $derived(
    s.log.flatMap((e) => (e.payload.kind === 'penalty' ? [{ e, p: e.payload }] : [])),
  );
  const offences = $derived(
    Object.entries(s.penaltiesByOffence)
      .map(([k, n]) => ({ k, label: OFFENCE_LABELS[k as keyof typeof OFFENCE_LABELS] ?? k, n }))
      .sort((a, b) => b.n - a.n),
  );
  const maxOff = $derived(Math.max(1, ...offences.map((o) => o.n)));
  const dots = $derived(
    pens.flatMap(({ e, p }) =>
      p.zone
        ? [
            {
              ...p.zone,
              kind: p.side,
              label: `${formatClock(e.gameMs - offset)} penalty ${p.side === 'for' ? 'to us' : 'against us'}${p.offence ? `, ${OFFENCE_LABELS[p.offence]}` : ''}`,
            },
          ]
        : [],
    ),
  );
  const endMs = $derived(Math.max(s.clock.gameMs, offset + 2 * v.cfg.halfMs));
  const minutes = $derived.by(() => {
    const ids = new Set([
      ...(v.lineup?.starters ?? []),
      ...(v.lineup?.bench ?? []),
      ...Object.keys(s.minutesPlayed),
    ]);
    return [...ids]
      .map((id) => ({ id, ms: s.minutesPlayed[id] ?? 0, shirt: v.lineup?.shirt.get(id) }))
      .sort((a, b) => b.ms - a.ms || (a.shirt ?? 99) - (b.shirt ?? 99));
  });
  const maxMin = $derived(Math.max(60e3, ...minutes.map((m) => m.ms)));
  const tackles = $derived.by(() => {
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- local to this derived
    const by = new Map<string, number>();
    for (const e of s.log)
      if (e.payload.kind === 'tally' && e.payload.tally === 'tackle' && e.payload.playerId)
        by.set(e.payload.playerId, (by.get(e.payload.playerId) ?? 0) + 1);
    return [...by.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  });
  const PAIRS = [
    ['Lineouts', 'lineout_won', 'lineout_lost'],
    ['Scrums', 'scrum_won', 'scrum_lost'],
    ['Turnovers', 'turnover_won', 'turnover_lost'],
    ['Restarts', 'restart_won', 'restart_lost'],
    ['Tackles', 'tackle', 'missed_tackle'],
  ] as const;
  const pct = (a: number, b: number) => (a + b ? `${Math.round((a / (a + b)) * 100)}%` : '–');

  let busy = $state<'square' | 'story' | 'copy' | null>(null);
  async function report(template: 'square' | 'story') {
    const team = v.snap?.team;
    if (!team || !event) return;
    const [{ renderMatchReport }, crest] = await Promise.all([
      import('@phaseplay/diagram/export/match-report'),
      loadCrest(team),
    ]);
    return renderMatchReport({
      template,
      team: {
        name: team.name,
        shortName: team.shortName,
        primary: team.colors.primary,
        secondary: team.colors.secondary,
        crest,
      },
      opponent: v.opponent,
      score: s.score,
      result,
      scorers: scoring
        .filter((e) => pointsFor(e.payload.type, v.cfg.points) > 0)
        .map((e) => ({
          minute: minuteOf(e.gameMs - offset),
          name:
            e.payload.team === 'us'
              ? e.payload.playerId
                ? name(e.payload.playerId)
                : team.shortName
              : v.opponent,
          type: SCORE_LABELS[e.payload.type],
          team: e.payload.team,
        })),
      cards: cards.map((c) => ({
        minute: minuteOf(c.e.gameMs - offset),
        name: c.who,
        colour: c.colour,
        team: c.team,
      })),
      progression: s.progression.map((p) => ({
        minute: (p.gameMs - offset) / 60e3,
        us: p.us,
        them: p.them,
      })),
      penalties: { for: s.penalties.for, against: s.penalties.against },
      date: fmtDay(event.startsAt, team.timezone),
    });
  }
  /**
   * Images are rendered ahead of time: phones only allow the share sheet straight after a tap, and
   * rendering (especially the tall story size) can take longer than that.
   */
  const ready: Partial<Record<'square' | 'story', Promise<Blob | undefined>>> = {};
  let readyKey = '';
  const reportKey = $derived(`${s.score.us}-${s.score.them}-${scoring.length}-${cards.length}`);
  $effect(() => {
    const key = reportKey;
    if (!event || !v.snap?.team) return;
    const t = setTimeout(() => {
      if (readyKey === key) return;
      readyKey = key;
      ready.square = report('square').catch(() => undefined);
      ready.story = ready.square.then(() => report('story')).catch(() => undefined);
    }, 600);
    return () => clearTimeout(t);
  });
  let preview = $state<{ url: string; blob: Blob; name: string } | null>(null);

  async function share(template: 'square' | 'story') {
    busy = template;
    try {
      const blob = (readyKey === reportKey && (await ready[template])) || (await report(template));
      if (!blob) return;
      const name = `${v.us}-v-${v.opponent}-${template}.png`.replace(/\s+/g, '-');
      const r = await shareOrDownload(blob, name, `${v.us} v ${v.opponent}`);
      if (r === 'blocked') {
        // The tap "expired" while rendering: show the image with its own Share button.
        preview = { url: URL.createObjectURL(blob), blob, name };
        return;
      }
      if (r === 'downloaded') toasts.success('Match report saved');
    } catch {
      toasts.error("Couldn't make the report image");
    } finally {
      busy = null;
    }
  }
  async function copy() {
    busy = 'copy';
    try {
      const blob = await report('square');
      toasts.show(
        blob && (await copyImage(blob))
          ? 'Report copied. Paste it in the team chat'
          : "Couldn't copy, try Share instead",
      );
    } finally {
      busy = null;
    }
  }
</script>

<svelte:head><title>Match summary · {v.opponent}</title></svelte:head>

<div class="sum">
  {#if !snap}
    <div class="page" aria-busy="true"></div>
  {:else if !event || !isGame(event.type)}
    <div class="page">
      <EmptyState title="No match here" body="Summaries are for games and tournaments.">
        {#snippet icon()}<IconMatch />{/snippet}
        {#snippet action()}<Button href="/schedule" variant="primary">Back to the schedule</Button
          >{/snippet}
      </EmptyState>
    </div>
  {:else}
    <div class="page">
      <header class="head">
        <a
          class="back"
          href={staff ? `/events/${event.id}/match` : `/events/${event.id}`}
          aria-label={staff ? 'Back to match mode' : 'Back to the event'}><IconBack /></a
        >
        <div class="grow">
          <p class="eyebrow">{fmtDay(event.startsAt, snap.team.timezone)} · {event.title}</p>
          <h1>Match summary</h1>
        </div>
        {#if v.tournament}<Button href="/events/{event.id}/match/day" size="sm"
            >Tournament day</Button
          >{/if}
      </header>

      {#if v.tournament && v.day.length > 1}
        <Segmented
          label="Game"
          bind:value={pick}
          options={v.day.map((d) => ({ value: String(d.game), label: `Game ${d.game}` }))}
        />
      {/if}

      <section class="card score" aria-label="Final score">
        <div class="team">
          <span class="tm">{v.us}</span><span class="pts tnum">{s.score.us}</span>
        </div>
        <div class="vs">
          <span class="res {result.toLowerCase()}">{s.clock.inPeriod ? 'Live' : result}</span>
          <small class="tnum"
            >{s.clock.inPeriod
              ? formatClock(s.clock.gameMs - offset)
              : s.clock.period
                ? 'Full time'
                : 'Not started'}</small
          >
        </div>
        <div class="team r">
          <span class="pts tnum">{s.score.them}</span><span class="tm">{v.opponent}</span>
        </div>
      </section>

      {#if !v.session.loaded}
        <p class="subtle">Loading the match log…</p>
      {:else if !s.log.length}
        <EmptyState
          title="Nothing recorded yet"
          body={staff
            ? 'Open match mode on the sideline and every tap lands here.'
            : "Once a coach records the match, it'll show up here."}
        >
          {#snippet icon()}<IconMatch />{/snippet}
          {#snippet action()}{#if staff}<Button href="/events/{event.id}/match" variant="primary"
                >{#snippet icon()}<IconPlay />{/snippet}Open match mode</Button
              >{/if}{/snippet}
        </EmptyState>
      {:else}
        <div class="share">
          <Button variant="primary" loading={busy === 'square'} onclick={() => share('square')}
            >{#snippet icon()}<IconShare />{/snippet}Share match report</Button
          >
          <Button loading={busy === 'story'} onclick={() => share('story')}>Story size</Button>
          <Button variant="ghost" loading={busy === 'copy'} onclick={copy}
            >{#snippet icon()}<IconCopy />{/snippet}Copy image</Button
          >
        </div>

        <div class="cols">
          <section class="card sec wide" aria-labelledby="h-prog">
            <h2 id="h-prog">Score progression</h2>
            <ProgressionChart
              points={s.progression}
              {endMs}
              halfMs={v.cfg.halfMs}
              {offset}
              us={v.us}
              them={v.opponent}
            />
          </section>

          <section class="card sec" aria-labelledby="h-sc">
            <h2 id="h-sc">Scorers</h2>
            {#if scorers.length}
              <ul class="list rows">
                {#each scorers as r (r.name + r.team)}
                  <li>
                    <span class="mk {r.team}" aria-hidden="true"></span>
                    <span class="grow"
                      ><strong>{r.name}</strong><small>{r.items.join(', ')}</small></span
                    >
                    <span class="tnum n">{r.pts}</span>
                  </li>
                {/each}
              </ul>
            {:else}<p class="subtle">No scores.</p>{/if}
          </section>

          <section class="card sec" aria-labelledby="h-cards">
            <h2 id="h-cards">Cards</h2>
            {#if cards.length}
              <ul class="list rows">
                {#each cards as c (c.e.id)}
                  <li>
                    <span class="cardsw {c.colour}" aria-hidden="true"></span>
                    <span class="grow"
                      ><strong>{c.who}</strong><small
                        >{c.colour === 'yellow' ? 'Yellow' : 'Red'} card</small
                      ></span
                    >
                    <span class="tnum n">{minuteOf(c.e.gameMs - offset)}'</span>
                  </li>
                {/each}
              </ul>
            {:else}<p class="subtle">A clean game. No cards.</p>{/if}
          </section>

          <section class="card sec" aria-labelledby="h-pen">
            <h2 id="h-pen">Penalties</h2>
            <p class="big tnum">
              <strong>{s.penalties.for}</strong> for · <strong>{s.penalties.against}</strong> against
            </p>
            <p class="subtle tnum">
              {#each Object.entries(s.penalties.byPeriod) as [per, c] (per)}
                <span class="per"
                  >{Number(per) % 2 ? '1st' : '2nd'} half: {c.for} for, {c.against} against</span
                >
              {/each}
            </p>
            {#if offences.length}
              <h3 class="sub">Conceded by type</h3>
              <ul class="list bars">
                {#each offences as o (o.k)}
                  <li>
                    <span class="bl">{o.label}</span>
                    <span class="track" aria-hidden="true"
                      ><span class="fill" style:width="{(o.n / maxOff) * 100}%"></span></span
                    >
                    <span class="tnum n">{o.n}</span>
                  </li>
                {/each}
              </ul>
            {/if}
          </section>

          <section class="card sec" aria-labelledby="h-zone">
            <h2 id="h-zone">Where the penalties were</h2>
            <MiniPitch
              mode="show"
              {dots}
              label="{dots.length} penalties plotted on the pitch, our try line on the left"
            />
            <div class="zl" aria-hidden="true">
              <span><i class="dot for"></i>To us</span><span
                ><i class="dot against"></i>Against us</span
              >
            </div>
            {#if dots.length}
              <details>
                <summary>List the penalty zones</summary>
                <ul class="list zlist">
                  {#each dots as d, i (i)}<li>{d.label}</li>{/each}
                </ul>
              </details>
            {:else}<p class="subtle">No zones tapped.</p>{/if}
          </section>

          <section class="card sec" aria-labelledby="h-set">
            <h2 id="h-set">Set piece and tallies</h2>
            <table class="tt">
              <thead
                ><tr
                  ><th scope="col">Tally</th><th scope="col">Won</th><th scope="col">Lost</th><th
                    scope="col">Rate</th
                  ></tr
                ></thead
              >
              <tbody>
                {#each PAIRS as [label, a, b] (label)}
                  {@const x = s.tallies[a] ?? 0}
                  {@const y = s.tallies[b] ?? 0}
                  <tr
                    ><th scope="row">{label}</th><td class="tnum">{x}</td><td class="tnum">{y}</td
                    ><td class="tnum">{pct(x, y)}</td></tr
                  >
                {/each}
              </tbody>
            </table>
            {#if tackles.length}
              <h3 class="sub">Top tacklers</h3>
              <ul class="list rows">
                {#each tackles as [id, n] (id)}<li>
                    <span class="grow">{name(id)}</span><span class="tnum n">{n}</span>
                  </li>{/each}
              </ul>
            {/if}
          </section>

          <section class="card sec" aria-labelledby="h-min">
            <h2 id="h-min">Minutes played</h2>
            {#if minutes.length}
              <ul class="list bars mins">
                {#each minutes as m (m.id)}
                  <li>
                    <span class="bl"><span class="no tnum">{m.shirt ?? ''}</span>{name(m.id)}</span>
                    <span class="track" aria-hidden="true"
                      ><span class="fill" style:width="{(m.ms / maxMin) * 100}%"></span></span
                    >
                    <span class="tnum n">{Math.round(m.ms / 60e3)}'</span>
                  </li>
                {/each}
              </ul>
            {:else}<p class="subtle">No team sheet, so minutes can't be counted.</p>{/if}
          </section>

          <section class="card sec" aria-labelledby="h-stop">
            <h2 id="h-stop">Stoppages</h2>
            {#if s.clock.stoppages.length}
              <ul class="list rows">
                {#each s.clock.stoppages as st, i (i)}
                  <li>
                    <span class="grow"
                      ><strong
                        >{STOPPAGE_LABELS[st.reason as keyof typeof STOPPAGE_LABELS] ??
                          st.reason}</strong
                      ><small class="tnum">at {formatClock(st.gameMs - offset)}</small></span
                    >
                    <span class="tnum n"
                      >{st.endWall ? formatClock(st.endWall - st.startWall) : 'ongoing'}</span
                    >
                  </li>
                {/each}
              </ul>
            {:else}<p class="subtle">No time off.</p>{/if}
          </section>

          <section class="card sec wide">
            <Timeline log={s.log} {snap} opponent={v.opponent} tournament={v.tournament} {offset} />
          </section>
        </div>
      {/if}
    </div>
  {/if}
</div>

<Sheet
  open={!!preview}
  onclose={() => {
    if (preview) URL.revokeObjectURL(preview.url);
    preview = null;
  }}
  title="Match report"
  description="Share it, or press and hold the image to save it."
  size="sm"
>
  {#if preview}<img
      class="rep-prev"
      src={preview.url}
      alt="Match report: {v.us} {s.score.us}, {v.opponent} {s.score.them}"
    />{/if}
  {#snippet footer()}
    <Button
      variant="primary"
      onclick={async () => {
        if (!preview) return;
        const r = await shareOrDownload(preview.blob, preview.name, `${v.us} v ${v.opponent}`);
        if (r === 'downloaded') toasts.success('Match report saved');
      }}>Share</Button
    >
  {/snippet}
</Sheet>

<style>
  .sum {
    --viz-us: #2a78d6;
    --viz-them: #eb6834;
    min-height: 100dvh;
  }
  @media (prefers-color-scheme: dark) {
    :global(:root:not([data-theme='light'])) .sum {
      --viz-us: #3987e5;
      --viz-them: #d95926;
    }
  }
  :global(:root[data-theme='dark']) .sum {
    --viz-us: #3987e5;
    --viz-them: #d95926;
  }
  .head {
    display: flex;
    align-items: center;
    gap: var(--s-3);
    margin-bottom: var(--s-4);
  }
  .back {
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    flex: none;
    border-radius: 50%;
    color: var(--text);
  }
  .back:hover {
    background: var(--surface-3);
  }
  .back :global(svg) {
    width: 20px;
    height: 20px;
  }
  .score {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
    align-items: center;
    gap: var(--s-3);
    margin: var(--s-4) 0;
    padding: var(--s-5);
  }
  .team {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .team.r {
    align-items: flex-end;
    text-align: right;
  }
  .tm {
    font-weight: 700;
    color: var(--text-2);
    overflow-wrap: anywhere;
  }
  .pts {
    font-size: clamp(2.75rem, 12vw, 4.5rem);
    font-weight: 800;
    line-height: 1;
  }
  .vs {
    display: flex;
    flex-direction: column;
    align-items: center;
  }
  .res {
    padding: 2px var(--s-3);
    border-radius: var(--r-full);
    background: var(--surface-3);
    font-weight: 750;
  }
  .res.win {
    background: var(--ok-soft);
    color: color-mix(in srgb, var(--ok) 72%, var(--text));
  }
  .res.loss {
    background: var(--danger-soft);
    color: var(--danger);
  }
  .vs small {
    margin-top: var(--s-1);
    color: var(--text-3);
    font-weight: 650;
  }
  .share {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-2);
    margin-bottom: var(--s-4);
  }
  .cols {
    display: grid;
    gap: var(--s-4);
  }
  @media (min-width: 900px) {
    .cols {
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    }
    .wide {
      grid-column: 1 / -1;
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
  .sub {
    margin: var(--s-4) 0 var(--s-2);
    font-size: var(--t-14);
    color: var(--text-2);
  }
  .rows li {
    display: flex;
    align-items: center;
    gap: var(--s-3);
    min-height: 44px;
    padding: var(--s-1) 0;
    border-bottom: 1px solid var(--border);
  }
  .rows li:last-child {
    border-bottom: 0;
  }
  .rows small {
    display: block;
    color: var(--text-2);
    font-size: var(--t-12);
  }
  .n {
    font-weight: 750;
  }
  .mk {
    flex: none;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--viz-us);
  }
  .mk.them {
    border-radius: 2px;
    background: var(--viz-them);
  }
  .cardsw {
    flex: none;
    width: 12px;
    height: 16px;
    border-radius: 2px;
    background: #f5c518;
  }
  .cardsw.red {
    background: #d92d20;
  }
  .big {
    font-size: var(--t-20);
  }
  .per {
    display: block;
  }
  .bars li {
    display: grid;
    grid-template-columns: minmax(110px, 40%) 1fr 36px;
    align-items: center;
    gap: var(--s-2);
    min-height: 32px;
    font-size: var(--t-14);
  }
  .bl {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .no {
    display: inline-block;
    width: 22px;
    color: var(--text-3);
    font-weight: 700;
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
    background: var(--viz-us);
  }
  .n {
    text-align: right;
  }
  .zl {
    display: flex;
    gap: var(--s-4);
    margin-top: var(--s-2);
    font-size: var(--t-12);
    font-weight: 650;
    color: var(--text-2);
  }
  .zl span {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .dot {
    display: inline-block;
    width: 9px;
    height: 12px;
    border-radius: 50%;
    background: var(--viz-us);
  }
  .dot.against {
    border-radius: 2px;
    background: var(--viz-them);
  }
  details {
    margin-top: var(--s-2);
    font-size: var(--t-14);
  }
  summary {
    cursor: pointer;
    min-height: 32px;
    display: inline-flex;
    align-items: center;
    color: var(--accent-text);
    font-weight: 650;
  }
  .zlist li {
    padding: 2px 0;
  }
  .tt {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--t-14);
  }
  .tt th,
  .tt td {
    padding: var(--s-2);
    border-bottom: 1px solid var(--border);
    text-align: right;
  }
  .tt th:first-child {
    text-align: left;
  }
  .tt thead th {
    color: var(--text-3);
    font-size: var(--t-12);
    font-weight: 700;
  }
  .rep-prev {
    display: block;
    max-width: 100%;
    max-height: 60dvh;
    margin: 0 auto;
    border-radius: var(--r-md);
  }
</style>
