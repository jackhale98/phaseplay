<!-- The <option>s of a teammate picker, grouped by memberChoices() (meta.ts). -->
<script lang="ts">
  import type { MemberChoices } from './meta';

  let { choices }: { choices: MemberChoices } = $props();
</script>

{#if choices.first.length}
  <optgroup label={choices.firstLabel}>
    {#each choices.first as m (m.id)}<option value={m.id}>{m.displayName}</option>{/each}
  </optgroup>
  {#if choices.rest.length}
    <optgroup label="Everyone else">
      {#each choices.rest as m (m.id)}<option value={m.id}>{m.displayName}</option>{/each}
    </optgroup>
  {/if}
{:else}
  {#each choices.rest as m (m.id)}<option value={m.id}>{m.displayName}</option>{/each}
{/if}
