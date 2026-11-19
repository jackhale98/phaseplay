<!--
  Full-screen pages viewer. Phones: pinch to zoom, drag to pan, double-tap to zoom, swipe between
  pages. Laptops: zoom buttons, Ctrl/⌘ + wheel or trackpad pinch, ← → (or PgUp/PgDn) between
  pages, + / − / 0 to zoom, arrows to move around when zoomed in, Esc to close. A modal <dialog>, so focus stays inside and the page behind is inert.
-->
<script lang="ts" module>
  export type ViewerItem = { src: string; alt: string; caption: string | null };
</script>

<script lang="ts">
  import {
    IconChevronLeft,
    IconChevronRight,
    IconX,
    IconZoomIn,
    IconZoomOut,
    IconReset,
  } from '#lib/icons';

  type Props = { open: boolean; items: ViewerItem[]; index: number; title: string };
  let { open = $bindable(false), items, index = $bindable(0), title }: Props = $props();
  let dialog: HTMLDialogElement | undefined = $state();
  let stage: HTMLDivElement | undefined = $state();
  let scale = $state(1);
  let tx = $state(0);
  let ty = $state(0);
  let natural = $state({ w: 0, h: 0 });
  const MIN = 1;
  const MAX = 6;

  const item = $derived(items[index]);
  const n = $derived(items.length);

  $effect(() => {
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  });
  $effect(() => {
    void index;
    reset();
  });

  function reset() {
    scale = 1;
    tx = 0;
    ty = 0;
  }
  /** Keep the zoomed picture covering the stage (no panning off into empty space). */
  function clamp() {
    if (!stage) return;
    const r = stage.getBoundingClientRect();
    const fit = Math.min(r.width / (natural.w || 1), r.height / (natural.h || 1));
    const w = (natural.w || r.width) * fit * scale;
    const h = (natural.h || r.height) * fit * scale;
    const mx = Math.max(0, (w - r.width) / 2);
    const my = Math.max(0, (h - r.height) / 2);
    tx = Math.min(mx, Math.max(-mx, tx));
    ty = Math.min(my, Math.max(-my, ty));
  }
  /** Zoom by `k` around a point in stage coordinates (centre by default). */
  function zoomBy(k: number, cx?: number, cy?: number) {
    const next = Math.min(MAX, Math.max(MIN, scale * k));
    if (stage && cx !== undefined && cy !== undefined) {
      const r = stage.getBoundingClientRect();
      const px = cx - r.left - r.width / 2;
      const py = cy - r.top - r.height / 2;
      const f = next / scale;
      tx = px - (px - tx) * f;
      ty = py - (py - ty) * f;
    } else {
      const f = next / scale;
      tx *= f;
      ty *= f;
    }
    scale = next;
    if (scale === 1) {
      tx = 0;
      ty = 0;
    }
    clamp();
  }
  function go(d: number) {
    if (n < 2) return;
    index = (index + d + n) % n;
  }

  const PAN = 80;
  const ARROWS: Record<string, [number, number]> = {
    ArrowLeft: [PAN, 0],
    ArrowRight: [-PAN, 0],
    ArrowUp: [0, PAN],
    ArrowDown: [0, -PAN],
  };
  function key(e: KeyboardEvent) {
    const pan = ARROWS[e.key];
    if (pan && scale > 1) {
      // Zoomed in: arrows move around the picture (PageUp/PageDown still change page).
      tx += pan[0];
      ty += pan[1];
      clamp();
    } else if (e.key === 'ArrowRight' || e.key === 'PageDown') go(1);
    else if (e.key === 'ArrowLeft' || e.key === 'PageUp') go(-1);
    else if (e.key === '+' || e.key === '=') zoomBy(1.5);
    else if (e.key === '-' || e.key === '_') zoomBy(1 / 1.5);
    else if (e.key === '0') reset();
    else return;
    e.preventDefault();
  }

  // Pointer gestures: one finger pans (or swipes pages at 1×), two fingers pinch.
  // Gesture bookkeeping only; nothing renders from it.
  // eslint-disable-next-line svelte/prefer-svelte-reactivity
  const pts = new Map<number, { x: number; y: number }>();
  let start: { d: number; scale: number; mx: number; my: number; tx: number; ty: number } | null =
    null;
  let drag: { x: number; y: number; tx: number; ty: number; t: number } | null = null;
  let lastTap = 0;

  function down(e: PointerEvent) {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 2) {
      const [a, b] = [...pts.values()] as [{ x: number; y: number }, { x: number; y: number }];
      start = {
        d: Math.hypot(a.x - b.x, a.y - b.y),
        scale,
        mx: (a.x + b.x) / 2,
        my: (a.y + b.y) / 2,
        tx,
        ty,
      };
      drag = null;
    } else if (pts.size === 1) {
      drag = { x: e.clientX, y: e.clientY, tx, ty, t: Date.now() };
    }
  }
  function move(e: PointerEvent) {
    if (!pts.has(e.pointerId)) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 2 && start && stage) {
      const [a, b] = [...pts.values()] as [{ x: number; y: number }, { x: number; y: number }];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const next = Math.min(MAX, Math.max(MIN, start.scale * (d / (start.d || 1))));
      const r = stage.getBoundingClientRect();
      const px = start.mx - r.left - r.width / 2;
      const py = start.my - r.top - r.height / 2;
      const f = next / start.scale;
      const mx = (a.x + b.x) / 2 - start.mx;
      const my = (a.y + b.y) / 2 - start.my;
      scale = next;
      tx = px - (px - start.tx) * f + mx;
      ty = py - (py - start.ty) * f + my;
      clamp();
    } else if (drag && scale > 1) {
      tx = drag.tx + (e.clientX - drag.x);
      ty = drag.ty + (e.clientY - drag.y);
      clamp();
    }
  }
  function up(e: PointerEvent) {
    const was = drag;
    pts.delete(e.pointerId);
    if (pts.size < 2) start = null;
    if (scale <= 1.02) {
      scale = 1;
      tx = 0;
      ty = 0;
    }
    if (!was || pts.size) {
      drag = null;
      return;
    }
    drag = null;
    const dx = e.clientX - was.x;
    const dy = e.clientY - was.y;
    const quick = Date.now() - was.t < 500;
    if (scale === 1 && quick && Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      go(dx < 0 ? 1 : -1);
      return;
    }
    if (Math.abs(dx) < 8 && Math.abs(dy) < 8 && e.pointerType === 'touch') {
      const now = Date.now();
      if (now - lastTap < 300) {
        if (scale > 1) reset();
        else zoomBy(2.5, e.clientX, e.clientY);
        lastTap = 0;
      } else lastTap = now;
    }
  }
  function wheel(e: WheelEvent) {
    // Trackpad pinch arrives as ctrl+wheel; plain wheel pans when zoomed.
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      zoomBy(Math.exp(-e.deltaY / 200), e.clientX, e.clientY);
    } else if (scale > 1) {
      e.preventDefault();
      tx -= e.deltaX;
      ty -= e.deltaY;
      clamp();
    }
  }
  function dbl(e: MouseEvent) {
    if (scale > 1) reset();
    else zoomBy(2.5, e.clientX, e.clientY);
  }
</script>

<dialog
  bind:this={dialog}
  class="viewer"
  aria-label="{title}: pictures"
  onclose={() => (open = false)}
  onkeydown={key}
>
  {#if open && item}
    <header class="bar">
      <p class="count" aria-live="polite">
        <span class="sr-only">{title}, </span>{n > 1
          ? `Page ${index + 1} of ${n}`
          : title}{item.caption ? ` · ${item.caption}` : ''}
      </p>
      <div class="tools">
        <button
          type="button"
          aria-label="Zoom out"
          disabled={scale <= MIN}
          onclick={() => zoomBy(1 / 1.5)}><IconZoomOut /></button
        >
        <span class="pct" aria-hidden="true">{Math.round(scale * 100)}%</span>
        <button
          type="button"
          aria-label="Zoom in"
          disabled={scale >= MAX}
          onclick={() => zoomBy(1.5)}><IconZoomIn /></button
        >
        <button type="button" aria-label="Reset zoom" disabled={scale === 1} onclick={reset}
          ><IconReset /></button
        >
        <button type="button" class="close" aria-label="Close" onclick={() => (open = false)}
          ><IconX /></button
        >
      </div>
    </header>
    <div
      class="stage"
      bind:this={stage}
      role="presentation"
      onpointerdown={down}
      onpointermove={move}
      onpointerup={up}
      onpointercancel={up}
      onwheel={wheel}
      ondblclick={dbl}
    >
      <img
        src={item.src}
        alt={item.alt}
        draggable="false"
        style:transform="translate({tx}px, {ty}px) scale({scale})"
        onload={(e) => {
          const im = e.currentTarget as HTMLImageElement;
          natural = { w: im.naturalWidth, h: im.naturalHeight };
        }}
      />
    </div>
    {#if n > 1}
      <button type="button" class="nav prev" aria-label="Previous page" onclick={() => go(-1)}
        ><IconChevronLeft /></button
      >
      <button type="button" class="nav next" aria-label="Next page" onclick={() => go(1)}
        ><IconChevronRight /></button
      >
    {/if}
    <p class="keys" aria-hidden="true">
      {scale > 1 ? 'Arrows move · PgUp PgDn pages' : '← → or PgUp PgDn pages'} · + − 0 zoom · Esc close
    </p>
  {/if}
</dialog>

<style>
  .viewer {
    position: fixed;
    inset: 0;
    width: 100vw;
    height: 100dvh;
    max-width: none;
    max-height: none;
    margin: 0;
    padding: 0;
    border: 0;
    background: #0b0f0d;
    color: #fff;
    overflow: hidden;
  }
  .viewer::backdrop {
    background: #000;
  }
  .bar {
    position: absolute;
    inset: 0 0 auto;
    z-index: 2;
    display: flex;
    align-items: center;
    gap: var(--s-2);
    padding: calc(var(--safe-t, 0px) + 6px) var(--s-2) 6px var(--s-4);
    background: linear-gradient(rgb(0 0 0 / 0.75), rgb(0 0 0 / 0));
  }
  .count {
    flex: 1;
    min-width: 0;
    margin: 0;
    font-weight: 650;
    font-size: var(--t-14);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .tools {
    display: flex;
    align-items: center;
    gap: 2px;
  }
  .tools button,
  .nav {
    width: 44px;
    height: 44px;
    display: grid;
    place-items: center;
    border: 0;
    border-radius: var(--r-full);
    background: rgb(255 255 255 / 0.12);
    color: #fff;
  }
  .tools button:disabled {
    opacity: 0.4;
  }
  .tools :global(svg),
  .nav :global(svg) {
    width: 20px;
    height: 20px;
  }
  .tools button:focus-visible,
  .nav:focus-visible {
    outline: 3px solid #fff;
    outline-offset: 2px;
  }
  .pct {
    min-width: 44px;
    text-align: center;
    font-size: var(--t-12);
    font-variant-numeric: tabular-nums;
  }
  .stage {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    touch-action: none;
    overflow: hidden;
    cursor: zoom-in;
  }
  .stage img {
    /* Fill the screen (small scans scale up too); the picture keeps its shape. */
    width: 100%;
    height: 100%;
    object-fit: contain;
    user-select: none;
    -webkit-user-select: none;
    transform-origin: center;
    will-change: transform;
  }
  .nav {
    position: absolute;
    top: 50%;
    z-index: 2;
    transform: translateY(-50%);
    width: 48px;
    height: 48px;
    background: rgb(0 0 0 / 0.55);
  }
  .prev {
    left: var(--s-2);
  }
  .next {
    right: var(--s-2);
  }
  .keys {
    position: absolute;
    bottom: calc(var(--safe-b, 0px) + 8px);
    left: 0;
    right: 0;
    margin: 0;
    text-align: center;
    font-size: var(--t-12);
    color: rgb(255 255 255 / 0.8);
  }
  @media (pointer: coarse) {
    .keys {
      display: none;
    }
    .pct {
      display: none;
    }
  }
</style>
