<!--
  The one loading state (docs/design.md §Brand): the brand play running in a loop. Appears only
  after `delay` ms so quick loads never flash it. The SVG's own CSS honours reduced motion.
-->
<script lang="ts">
  type Props = { label?: string; size?: number; delay?: number };
  let { label = 'Loading', size = 96, delay = 300 }: Props = $props();
  let shown = $state(false);
  $effect(() => {
    const t = setTimeout(() => (shown = true), delay);
    return () => clearTimeout(t);
  });
</script>

<div class="loader" role="status" aria-live="polite">
  {#if shown}
    <img
      src="/brand/phaseplay-loader.svg"
      alt=""
      width={Math.round((size * 108) / 120)}
      height={size}
    />
  {/if}
  <span class="sr-only">{label}</span>
</div>

<style>
  .loader {
    display: grid;
    place-items: center;
    min-height: 160px;
  }
  img {
    display: block;
  }
</style>
