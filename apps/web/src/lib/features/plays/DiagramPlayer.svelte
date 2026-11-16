<!--
  Read-only animated diagram (docs/diagrams.md §Viewer). Used by the play viewer, drill pages and
  the practice runner. rAF runs only while playing; reduced motion disables autoplay.
  Props: play, autoplay, loop (defaults to play.loop), controls (default true), highlightMemberId,
  theme ('grass' | 'chalkboard' | 'print' or a Theme).
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import type { Play } from '@phaseplay/shared';
  import { frameTimes, totalDuration } from '@phaseplay/diagram/sample';
  import { playViewport } from '@phaseplay/diagram/viewport';
  import { app } from '#lib/data/app.svelte';
  import { IconPlay, IconPause, IconRepeat, IconChevronLeft, IconChevronRight } from '#lib/icons';
  import { Stage, prefersReducedMotion, type StageTheme } from './stage';

  type Props = {
    play: Play;
    autoplay?: boolean;
    loop?: boolean;
    controls?: boolean;
    highlightMemberId?: string;
    theme?: StageTheme;
  };
  let {
    play,
    autoplay = false,
    loop,
    controls = true,
    highlightMemberId,
    theme = 'grass',
  }: Props = $props();

  let canvas: HTMLCanvasElement | undefined = $state();
  let box: HTMLDivElement | undefined = $state();
  let stage: Stage | null = null;
  let width = $state(0);
  let t = $state(0);
  let playing = $state(false);
  let speed = $state<0.5 | 1>(1);
  let loopOverride = $state<boolean | null>(null);
  const looping = $derived(loopOverride ?? loop ?? play.loop ?? false);
  const total = $derived(totalDuration(play));
  const times = $derived(frameTimes(play));
  const n = $derived(play.frames.length);
  /** The frame being shown: the one animating in, or the last one reached. */
  const frame = $derived.by(() => {
    let i = 0;
    for (let k = 1; k < times.length; k++) if (t > (times[k - 1] as number) + 0.5) i = k;
    return i;
  });
  const caption = $derived(play.frames[frame]?.caption ?? '');
  const accent = $derived(app.team?.colors.primary);

  const vp = $derived(playViewport(play));
  const landscape = $derived(width >= 560 && vp.h > vp.w * 1.1);
  const ratio = $derived(Math.min(2.2, Math.max(0.62, landscape ? vp.h / vp.w : vp.w / vp.h)));

  let raf = 0;
  let last = 0;
  let hold = 0;

  function paint() {
    if (!stage || !canvas) return;
    stage.orientation = landscape ? 'landscape' : 'portrait';
    stage.paint(play, t, { highlightMemberId });
  }

  function tick(now: number) {
    const dt = last ? Math.min(100, now - last) : 16;
    last = now;
    if (hold > 0) {
      hold -= dt;
      if (hold <= 0) t = 0;
    } else {
      t += dt * speed;
      if (t >= total) {
        if (looping && total > 0) {
          t = total;
          hold = 700;
        } else {
          t = total;
          paint();
          stop();
          return;
        }
      }
    }
    paint();
    raf = requestAnimationFrame(tick);
  }

  export function start() {
    if (playing || total <= 0) return;
    if (t >= total) t = 0;
    playing = true;
    last = 0;
    hold = 0;
    raf = requestAnimationFrame(tick);
  }
  export function stop() {
    playing = false;
    cancelAnimationFrame(raf);
    raf = 0;
  }
  function toggle() {
    if (playing) stop();
    else start();
  }
  function step(d: -1 | 1) {
    stop();
    const target = Math.max(0, Math.min(n - 1, frame + d));
    t = times[target] ?? 0;
  }

  onMount(() => {
    if (!canvas || !box) return;
    stage = new Stage(canvas, { theme, accent });
    const ro = new ResizeObserver(([e]) => {
      if (!e || !stage) return;
      width = e.contentRect.width;
      stage.resize(e.contentRect.width, e.contentRect.height);
      paint();
    });
    ro.observe(box);
    if (autoplay && !prefersReducedMotion()) start();
    return () => {
      ro.disconnect();
      stop();
    };
  });

  // Repaint when anything visible changes while paused (the loop paints itself while playing).
  $effect(() => {
    void [play, highlightMemberId, landscape, t];
    if (!playing) paint();
  });
  $effect(() => {
    if (stage) stage.accent = accent ?? stage.accent;
  });
  // A new play restarts from the top.
  let lastPlay: Play | null = null;
  $effect(() => {
    if (lastPlay && lastPlay.id !== play.id) {
      stop();
      t = 0;
      if (autoplay && !prefersReducedMotion()) start();
    }
    lastPlay = play;
  });

  const label = $derived(
    `${play.title || 'Diagram'}. Frame ${frame + 1} of ${n}${caption ? `: ${caption}` : ''}`,
  );
  const secs = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
</script>

<div class="player" class:has-controls={controls}>
  <div class="stage" bind:this={box} style:aspect-ratio={ratio}>
    <div class="art" role="img" aria-label={label}><canvas bind:this={canvas}></canvas></div>
    {#if controls && !playing && t === 0 && total > 0}
      <button class="big-play" onclick={start} aria-label="Play {play.title}">
        <IconPlay />
      </button>
    {/if}
  </div>
  {#if caption}
    <p class="caption" aria-live={playing ? 'off' : 'polite'}>{caption}</p>
  {/if}
  {#if controls}
    <div class="controls" role="group" aria-label="Playback">
      <button
        class="ctl"
        onclick={() => step(-1)}
        aria-label="Previous frame"
        disabled={frame === 0 && t === 0}
      >
        <IconChevronLeft />
      </button>
      <button
        class="ctl main"
        onclick={toggle}
        aria-label={playing ? 'Pause' : 'Play'}
        disabled={total <= 0}
      >
        {#if playing}<IconPause />{:else}<IconPlay />{/if}
      </button>
      <button class="ctl" onclick={() => step(1)} aria-label="Next frame" disabled={frame >= n - 1}>
        <IconChevronRight />
      </button>
      <input
        class="scrub"
        type="range"
        min="0"
        max={Math.max(1, total)}
        step="10"
        value={t}
        aria-label="Scrub through the play"
        aria-valuetext="Frame {frame + 1} of {n}, {secs(t)}"
        oninput={(e) => {
          stop();
          t = Number(e.currentTarget.value);
        }}
      />
      <span class="count tnum" aria-hidden="true">{frame + 1}/{n}</span>
      <button
        class="ctl pill tnum"
        onclick={() => (speed = speed === 1 ? 0.5 : 1)}
        aria-label="Speed {speed === 1 ? 'normal' : 'half'}, switch to {speed === 1
          ? 'half'
          : 'normal'} speed"
      >
        {speed === 1 ? '1×' : '0.5×'}
      </button>
      <button
        class="ctl"
        class:on={looping}
        onclick={() => (loopOverride = !looping)}
        aria-label="Loop"
        aria-pressed={looping}
      >
        <IconRepeat />
      </button>
    </div>
  {/if}
</div>

<style>
  .player {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
    width: 100%;
  }
  .stage {
    position: relative;
    width: 100%;
    max-height: 72dvh;
    border-radius: var(--r-md);
    overflow: hidden;
    background: #2f6b3a;
  }
  .art {
    position: absolute;
    inset: 0;
  }
  canvas {
    display: block;
    width: 100%;
    height: 100%;
  }
  .big-play {
    position: absolute;
    inset: 0;
    margin: auto;
    width: 64px;
    height: 64px;
    border-radius: var(--r-full);
    border: 0;
    background: rgb(12 16 13 / 0.72);
    color: #fff;
    display: grid;
    place-items: center;
    box-shadow: var(--e-2);
  }
  .big-play :global(svg) {
    width: 28px;
    height: 28px;
    margin-left: 3px;
  }
  .caption {
    margin: 0;
    padding: var(--s-2) var(--s-3);
    border-radius: var(--r-md);
    background: var(--surface-2);
    font-weight: 600;
    min-height: 2.5em;
  }
  .controls {
    display: flex;
    align-items: center;
    gap: var(--s-1);
  }
  .ctl {
    flex: none;
    min-width: 44px;
    height: 44px;
    display: grid;
    place-items: center;
    border: 1px solid var(--border);
    border-radius: var(--r-full);
    background: var(--surface);
    color: var(--text);
  }
  .ctl:disabled {
    opacity: 0.45;
    cursor: default;
  }
  .ctl :global(svg) {
    width: 20px;
    height: 20px;
  }
  .ctl.main {
    background: var(--accent);
    color: var(--on-accent);
    border-color: transparent;
    min-width: 48px;
    height: 48px;
  }
  .ctl.pill {
    padding: 0 var(--s-3);
    font-weight: 700;
    font-size: var(--t-14);
  }
  .ctl.on {
    background: var(--accent-soft);
    color: var(--accent-text);
    border-color: color-mix(in srgb, var(--accent) 40%, transparent);
  }
  .scrub {
    flex: 1 1 auto;
    min-width: 60px;
    height: 44px;
    accent-color: var(--accent);
  }
  .count {
    font-size: var(--t-14);
    color: var(--text-2);
    min-width: 2.6em;
    text-align: center;
  }
  @media (max-width: 380px) {
    .count {
      display: none;
    }
  }
</style>
