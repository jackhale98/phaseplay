<script lang="ts">
  /** A team role name with its colour dot. Pressable when `onclick` is given. */
  type Props = { name: string; color: string; selected?: boolean; onclick?: () => void };
  let { name, color, selected = false, onclick }: Props = $props();
</script>

{#if onclick}
  <button type="button" class="tag" class:selected aria-pressed={selected} {onclick}
    ><span class="dot" style:background={color}></span>{name}</button
  >
{:else}
  <span class="tag"><span class="dot" style:background={color}></span>{name}</span>
{/if}

<style>
  .tag {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: 32px;
    padding: 0 var(--s-3);
    border: 1px solid var(--border);
    border-radius: 999px;
    background: var(--surface);
    color: var(--text);
    font: inherit;
    font-size: var(--t-14);
    font-weight: 600;
  }
  button.tag {
    min-height: 44px;
    cursor: pointer;
  }
  button.tag:not(.selected):hover {
    background: var(--surface-2);
  }
  /* Selected: the shared solid fill (tokens.css --sel), not a tint. */
  button.tag.selected {
    border-color: var(--sel);
    background: var(--sel);
    color: var(--on-sel);
  }
  .dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--text) 25%, transparent);
  }
</style>
