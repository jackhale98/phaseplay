<!-- The team's uploaded emblem when it has one, else a monogram crest from team colours (PLAN.md M1). -->
<script lang="ts">
  import { fillAccent, type TeamColors } from '@phaseplay/shared';
  type Props = {
    colors: TeamColors;
    text: string;
    size?: number;
    label?: string;
    src?: string | null;
  };
  let { colors, text, size = 40, label, src = null }: Props = $props();
  const fill = $derived(fillAccent(colors.primary));
  const t = $derived(text.slice(0, 4).toUpperCase());
  const fs = $derived(t.length <= 2 ? 22 : t.length === 3 ? 17 : 13.5);
  let failed = $state<string | null>(null);
</script>

{#if src && failed !== src}
  <img
    class="crest-img"
    {src}
    width={size}
    height={Math.round(size * 1.12)}
    alt={label ?? `${text} crest`}
    decoding="async"
    onerror={() => (failed = src)}
  />
{:else}
  <svg
    width={size}
    height={size * 1.12}
    viewBox="0 0 40 45"
    role="img"
    aria-label={label ?? `${text} crest`}
  >
    <path
      d="M20 1.5 37.5 6v15.5C37.5 33 29.6 40.6 20 43.5 10.4 40.6 2.5 33 2.5 21.5V6Z"
      fill={fill.bg}
    />
    <path
      d="M20 1.5 37.5 6v15.5C37.5 33 29.6 40.6 20 43.5 10.4 40.6 2.5 33 2.5 21.5V6Z"
      fill="none"
      stroke={colors.secondary}
      stroke-width="2.5"
    />
    <path d="M6 30h28" stroke={colors.secondary} stroke-width="2" opacity="0.9" />
    <text
      x="20"
      y="24.5"
      text-anchor="middle"
      dominant-baseline="middle"
      font-family="PP Sans, system-ui, sans-serif"
      font-weight="800"
      font-size={fs}
      letter-spacing="-0.5"
      fill={fill.fg}>{t}</text
    >
  </svg>
{/if}

<style>
  .crest-img {
    display: block;
    object-fit: contain;
    flex: none;
  }
</style>
