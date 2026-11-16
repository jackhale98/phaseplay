<!-- The last 10 published versions of a sheet, newest first, each restorable into the draft. -->
<script lang="ts">
  import type { SheetVersion } from './model';
  import { api } from '#lib/api';
  import { teamPath } from '#lib/data/actions';
  import Sheet from '#lib/components/Sheet.svelte';
  import Button from '#lib/components/Button.svelte';
  import Badge from './Badge.svelte';
  import { dateTime } from '#lib/format';
  import { IconReset } from '#lib/icons';

  type Props = {
    open: boolean;
    sheetId: string | null;
    tz: string;
    nameOf: (id: string) => string;
    onrestore: (v: SheetVersion) => void;
  };
  let { open = $bindable(), sheetId, tz, nameOf, onrestore }: Props = $props();
  let versions = $state.raw<SheetVersion[] | null>(null);
  let error = $state<string | null>(null);

  $effect(() => {
    if (!open || !sheetId) return;
    versions = null;
    error = null;
    let cancelled = false;
    api<{ versions: SheetVersion[] }>(teamPath(`/sheets/${sheetId}/versions`))
      .then((r) => !cancelled && (versions = r.versions))
      .catch((e: Error) => !cancelled && (error = e.message));
    return () => {
      cancelled = true;
    };
  });
</script>

<Sheet
  bind:open
  title="Published versions"
  description="The last 10 times this sheet went out. Restoring puts it back in your draft."
  size="md"
>
  {#if error}
    <p class="muted">{error}</p>
  {:else if !versions}
    <p class="muted" aria-busy="true">Loading versions…</p>
  {:else if !versions.length}
    <p class="muted">Nothing published yet. Versions appear here each time you publish.</p>
  {:else}
    <ul class="list vs">
      {#each versions as v, i (v.version)}
        {@const n = Object.values(v.slots).filter(Boolean).length}
        <li class="card">
          <div class="grow">
            <strong>{dateTime(v.publishedAt ?? v.createdAt, tz)}</strong>
            {#if i === 0}<Badge tone="ok">Latest</Badge>{/if}
            <small class="muted"
              >{n} named{v.captainId ? ` · Captain ${nameOf(v.captainId)}` : ''}</small
            >
          </div>
          <Button
            size="sm"
            onclick={() => onrestore(v)}
            aria-label="Restore version from {dateTime(v.publishedAt ?? v.createdAt, tz)}"
          >
            {#snippet icon()}<IconReset />{/snippet}Restore
          </Button>
        </li>
      {/each}
    </ul>
  {/if}
</Sheet>

<style>
  .vs {
    display: grid;
    gap: var(--s-2);
  }
  .vs li {
    display: flex;
    align-items: center;
    gap: var(--s-3);
    padding: var(--s-3) var(--s-4);
    box-shadow: none;
  }
  .vs small {
    display: block;
  }
  strong {
    margin-right: var(--s-2);
  }
</style>
