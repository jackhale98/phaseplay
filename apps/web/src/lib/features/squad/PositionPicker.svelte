<!-- Pick positions in order: the first one chosen is the primary position. -->
<script lang="ts">
  import { POSITIONS_15 } from '@phaseplay/shared';
  let { value = $bindable(), disabled = false }: { value: number[]; disabled?: boolean } = $props();
  const rows = [[1, 2, 3], [4, 5], [6, 7, 8], [9, 10], [12, 13], [11, 14, 15]];
  function toggle(n: number) {
    value = value.includes(n) ? value.filter((x) => x !== n) : [...value, n].slice(0, 6);
  }
</script>

<div class="pp" role="group" aria-label="Positions, first chosen is primary">
  {#each rows as r, i (i)}
    <div class="r">
      {#each r as n (n)}
        {@const pos = POSITIONS_15.find((p) => p.n === n)!}
        {@const idx = value.indexOf(n)}
        <button type="button" {disabled} aria-pressed={idx >= 0} class:primary={idx === 0} onclick={() => toggle(n)} title={pos.name} aria-label="{pos.name}{idx === 0 ? ', primary' : ''}">
          <span class="n tnum">{n}</span><span class="s">{pos.short}</span>
        </button>
      {/each}
    </div>
  {/each}
  <p class="subtle">{value.length ? `Primary: ${POSITIONS_15.find((p) => p.n === value[0])?.name}` : 'Tap positions in order of preference.'}</p>
</div>

<style>
  .pp {
    display: grid;
    gap: var(--s-2);
  }
  .r {
    display: flex;
    justify-content: center;
    gap: var(--s-2);
  }
  button {
    display: grid;
    place-items: center;
    width: 64px;
    height: 52px;
    border-radius: var(--r-md);
    border: 1px solid var(--border-strong);
    background: var(--surface);
    line-height: 1.1;
  }
  .n {
    font-weight: 800;
  }
  .s {
    font-size: 0.6875rem;
    color: var(--text-3);
    font-weight: 650;
  }
  button[aria-pressed='true'] {
    background: var(--accent-soft);
    border-color: var(--accent);
  }
  .primary {
    background: var(--accent) !important;
    color: var(--on-accent);
  }
  .primary .s {
    color: inherit;
    opacity: 0.85;
  }
  p {
    text-align: center;
  }
</style>
