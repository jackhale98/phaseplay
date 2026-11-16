<script lang="ts">
  import { initials } from '@phaseplay/shared';
  type Props = { name: string; size?: number; jersey?: number | null; muted?: boolean };
  let { name, size = 36, jersey = null, muted = false }: Props = $props();
  // Stable hue per name so the squad list is scannable without relying on colour alone.
  const hue = $derived([...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7));
</script>

<span class="av" class:muted style:--size="{size}px" style:--hue={hue} aria-hidden="true">
  {jersey !== null && jersey !== undefined ? jersey : initials(name, 2)}
</span>

<style>
  .av {
    display: inline-grid;
    place-items: center;
    flex: none;
    width: var(--size);
    height: var(--size);
    border-radius: 50%;
    font-size: calc(var(--size) * 0.38);
    font-weight: 750;
    font-variant-numeric: tabular-nums;
    background: hsl(var(--hue) 45% 90%);
    color: hsl(var(--hue) 55% 24%);
  }
  :global(:root[data-theme='dark']) .av {
    background: hsl(var(--hue) 30% 22%);
    color: hsl(var(--hue) 60% 85%);
  }
  @media (prefers-color-scheme: dark) {
    :global(:root:not([data-theme='light'])) .av {
      background: hsl(var(--hue) 30% 22%);
      color: hsl(var(--hue) 60% 85%);
    }
  }
  /* Not joined yet: dashed outline instead of fading, so the initials keep AA contrast. */
  .muted {
    background: var(--surface) !important;
    color: var(--text-2) !important;
    box-shadow: inset 0 0 0 1.5px var(--border-strong);
    outline: 1.5px dashed var(--border-strong);
    outline-offset: -1.5px;
  }
</style>
