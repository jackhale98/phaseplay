<!--
  Card thumbnail: a static "at a glance" frame (start positions plus every path), animating in a
  loop only while `active` (hovered/focused) and motion is allowed. Decorative: the card carries
  the accessible name.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import type { Play } from '@phaseplay/shared';
  import { overviewScene, totalDuration } from '@phaseplay/diagram/sample';
  import { app } from '#lib/data/app.svelte';
  import { Stage, contentViewport, prefersReducedMotion } from './stage';

  let { play, active = false }: { play: Play | null; active?: boolean } = $props();
  let canvas: HTMLCanvasElement | undefined = $state();
  let stage: Stage | null = null;
  let raf = 0;
  let t0 = 0;

  function frame() {
    if (stage && play) stage.viewport = contentViewport(play);
  }
  function still() {
    if (!stage || !play) return;
    frame();
    stage.paintScene(play, overviewScene(play), {});
  }
  function loop(now: number) {
    if (!stage || !play) return;
    const total = totalDuration(play);
    if (!t0) t0 = now;
    const span = total + 900;
    const t = Math.min(total, (now - t0) % span);
    stage.paint(play, t, {});
    raf = requestAnimationFrame(loop);
  }

  onMount(() => {
    if (!canvas) return;
    stage = new Stage(canvas, { accent: app.team?.colors.primary, padding: 4 });
    const ro = new ResizeObserver(([e]) => {
      if (!e || !stage) return;
      stage.resize(e.contentRect.width, e.contentRect.height);
      if (!raf) still();
    });
    ro.observe(canvas);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(raf);
    };
  });

  $effect(() => {
    const p = play;
    const on = active && !!p && totalDuration(p) > 0 && !prefersReducedMotion();
    cancelAnimationFrame(raf);
    raf = 0;
    if (on) {
      frame();
      t0 = 0;
      raf = requestAnimationFrame(loop);
    } else still();
  });
</script>

<canvas bind:this={canvas} aria-hidden="true" class:empty={!play}></canvas>

<style>
  canvas {
    display: block;
    width: 100%;
    aspect-ratio: 16 / 10;
    background: #2f6b3a;
  }
  canvas.empty {
    background: linear-gradient(90deg, #2f6b3a 0 50%, #2a6234 50% 100%);
    background-size: 20% 100%;
  }
</style>
