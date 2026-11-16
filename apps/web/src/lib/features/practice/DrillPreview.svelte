<script lang="ts">
  /**
   * Small canvas player for a drill diagram. Animates only while on screen, the tab is visible
   * and reduced motion is off; otherwise shows the finished picture.
   */
  import type { Play } from '@phaseplay/shared';
  // Subpath imports keep the exporters (and their encoders) out of this chunk.
  import { draw } from '@phaseplay/diagram/draw';
  import { getPitchLayer } from '@phaseplay/diagram/pitch';
  import { grass } from '@phaseplay/diagram/themes';
  import { bestOrientation, makeTransform, playViewport } from '@phaseplay/diagram/viewport';
  import { overviewScene, sample, totalDuration, type Scene } from '@phaseplay/diagram/sample';

  type Props = { play: Play; playing?: boolean; label: string; height?: string };
  let { play, playing = false, label, height = '220px' }: Props = $props();

  let wrap: HTMLDivElement | undefined = $state();
  let canvas: HTMLCanvasElement | undefined = $state();
  let size = $state({ w: 0, h: 0 });
  let onScreen = $state(true);
  let tabVisible = $state(true);
  let reduced = $state(false);

  $effect(() => {
    const mq = matchMedia('(prefers-reduced-motion: reduce)');
    reduced = mq.matches;
    const on = () => (reduced = mq.matches);
    mq.addEventListener('change', on);
    const vis = () => (tabVisible = document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', vis);
    return () => {
      mq.removeEventListener('change', on);
      document.removeEventListener('visibilitychange', vis);
    };
  });

  $effect(() => {
    if (!wrap) return;
    const ro = new ResizeObserver(([e]) => {
      if (e) size = { w: Math.round(e.contentRect.width), h: Math.round(e.contentRect.height) };
    });
    ro.observe(wrap);
    const io = new IntersectionObserver(([e]) => (onScreen = !!e?.isIntersecting));
    io.observe(wrap);
    return () => {
      ro.disconnect();
      io.disconnect();
    };
  });

  function accent() {
    return (
      getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#1f6f43'
    );
  }

  function render(scene: Scene) {
    if (!canvas || !size.w || !size.h) return;
    const dpr = Math.min(2, devicePixelRatio || 1);
    const W = Math.round(size.w * dpr);
    const H = Math.round(size.h * dpr);
    if (canvas.width !== W) canvas.width = W;
    if (canvas.height !== H) canvas.height = H;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const viewport = playViewport(play);
    const t = makeTransform({
      viewport,
      width: W,
      height: H,
      orientation: bestOrientation(viewport, W, H),
      padding: 4 * dpr,
    });
    ctx.clearRect(0, 0, W, H);
    draw(ctx, scene, {
      theme: grass,
      transform: t,
      accent: accent(),
      pitchLayer: getPitchLayer(t, grass, play.background),
      background: play.background,
    });
  }

  const animate = $derived(playing && onScreen && tabVisible && !reduced);

  $effect(() => {
    void size.w;
    void size.h;
    if (!animate) {
      render(playing ? sample(play, totalDuration(play)) : overviewScene(play));
      return;
    }
    const total = Math.max(1, totalDuration(play));
    let raf = 0;
    let t0 = 0;
    const loop = (ts: number) => {
      if (!t0) t0 = ts;
      // Hold a beat on the last frame before looping.
      render(sample(play, Math.min(total, (ts - t0) % (total + 1200))));
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  });
</script>

<div class="dp" bind:this={wrap} style:height>
  <canvas bind:this={canvas} aria-hidden="true"></canvas>
  <span class="sr-only">{label}</span>
</div>

<style>
  .dp {
    position: relative;
    width: 100%;
    border-radius: var(--r-md);
    overflow: hidden;
    background: #2f6b3a;
  }
  canvas {
    width: 100%;
    height: 100%;
  }
</style>
