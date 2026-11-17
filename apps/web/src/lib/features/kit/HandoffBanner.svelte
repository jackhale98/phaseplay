<!-- Kit someone wants to hand me: Accept / Decline (PLAN.md M9 §Holding and handing over). -->
<script lang="ts">
  import IconPackage from '@lucide/svelte/icons/package';
  import { app } from '#lib/data/app.svelte';
  import { incomingHandoffs, memberName } from '#lib/data/selectors';
  import type { LocalHandoff } from '#lib/data/types';
  import { itemLabel, itemPhrase } from './meta';
  import { answerHandoff } from './actions';

  const s = $derived(app.snap);
  const list = $derived(incomingHandoffs(s));

  function answer(h: LocalHandoff, how: 'accept' | 'decline') {
    const item = s?.rows.items?.[h.itemId];
    void answerHandoff(
      h,
      how,
      how === 'accept'
        ? `Taking the ${item ? itemPhrase(item) : 'kit'}`
        : `Declining the ${item ? itemPhrase(item) : 'kit'}`,
    );
  }
</script>

{#each list as h (h.id)}
  {@const item = s?.rows.items?.[h.itemId]}
  {#if item}
    <aside class="ho card" aria-label="Kit handover">
      <span class="ic"><IconPackage /></span>
      <p class="grow">
        <strong
          >{memberName(s, h.fromMemberId)} wants to hand you the
          <a href="/kit/{item.id}">{itemLabel(item)}</a>.</strong
        >
        {#if h.note}<span class="note">“{h.note}”</span>{/if}
      </p>
      {#if h.queued}
        <p class="queued" role="status">
          {h.queued === 'accept' ? 'Accepted' : 'Declined'}, waiting to send{app.online
            ? '…'
            : ". You're offline."}
        </p>
      {:else}
        <div class="acts">
          <button class="go" type="button" onclick={() => answer(h, 'accept')}>Accept</button>
          <button class="no" type="button" onclick={() => answer(h, 'decline')}>Decline</button>
        </div>
      {/if}
    </aside>
  {/if}
{/each}

<style>
  .ho {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--s-3);
    padding: var(--s-3) var(--s-4);
    margin-bottom: var(--s-4);
    background: color-mix(in srgb, var(--info) 8%, var(--surface));
  }
  .ic {
    display: grid;
    place-items: center;
    width: 40px;
    height: 40px;
    border-radius: var(--r-md);
    background: var(--info-soft);
    color: var(--info);
    flex: none;
  }
  .ic :global(svg) {
    width: 20px;
    height: 20px;
  }
  p {
    margin: 0;
    min-width: 12rem;
  }
  .note {
    display: block;
    color: var(--text-2);
    font-size: var(--t-14);
  }
  .acts {
    display: flex;
    gap: var(--s-2);
  }
  .acts button {
    min-height: 44px;
    padding: 0 var(--s-4);
    border-radius: var(--r-full);
    font-weight: 650;
    border: 1px solid var(--border-strong);
    background: var(--surface);
  }
  .acts .go {
    background: var(--accent);
    color: var(--on-accent);
    border-color: transparent;
  }
  .queued {
    color: var(--text-2);
    font-size: var(--t-14);
    font-weight: 600;
  }
</style>
