<script lang="ts">
  import type { Member, PlayMeta, SeenBy } from '@phaseplay/shared';
  import Avatar from '#lib/components/Avatar.svelte';
  import Button from '#lib/components/Button.svelte';
  import { copyText } from '#lib/share';
  import { toasts } from '#lib/stores/toast.svelte';
  import { ago } from '#lib/format';
  import { IconCopy, IconCheck } from '#lib/icons';
  import { seenBy } from './persist';

  let { play, members }: { play: PlayMeta; members: Member[] } = $props();
  let data = $state<SeenBy | null>(null);
  let failed = $state(false);

  $effect(() => {
    const id = play.id;
    failed = false;
    void seenBy(id, true).then((s) => {
      data = s;
      failed = !s;
    });
  });

  const squad = $derived(members.filter((m) => m.role === 'player' && m.status === 'active'));
  const seenMap = $derived(new Map((data?.seen ?? []).map((s) => [s.memberId, s.firstViewedAt])));
  const seen = $derived(squad.filter((m) => seenMap.has(m.id)));
  const notSeen = $derived(squad.filter((m) => !seenMap.has(m.id)));

  async function nudge() {
    const names = notSeen.map((m) => m.displayName.split(' ')[0]).join(', ');
    const text = `${names ? `${names}: ` : ''}have a look at “${play.title}” before we run it. It's in the playbook: https://phaseplay.app/plays/${play.id}`;
    toasts.show(
      (await copyText(text)) ? 'Nudge copied. Paste it in the group chat' : "Couldn't copy",
    );
  }
</script>

<section class="seen card" aria-labelledby="seen-h">
  <header>
    <h2 id="seen-h">Seen by <span class="tnum">{data ? seen.length : '–'}/{squad.length}</span></h2>
    {#if notSeen.length && data}
      <Button size="sm" onclick={nudge}>{#snippet icon()}<IconCopy />{/snippet}Copy a nudge</Button>
    {/if}
  </header>
  {#if play.visibility === 'coaches'}
    <p class="subtle">
      Only coaches can see this play. Share it with the team to track who's watched it.
    </p>
  {:else if failed}
    <p class="subtle">Couldn't load views right now.</p>
  {:else if data}
    {#if notSeen.length}
      <h3 class="eyebrow">Not seen yet · {notSeen.length}</h3>
      <ul class="list people">
        {#each notSeen as m (m.id)}
          <li>
            <Avatar name={m.displayName} jersey={m.jersey} size={28} /> <span>{m.displayName}</span>
          </li>
        {/each}
      </ul>
    {:else}
      <p class="all"><IconCheck /> The whole squad has seen it.</p>
    {/if}
    {#if seen.length}
      <h3 class="eyebrow">Seen · {seen.length}</h3>
      <ul class="list people">
        {#each seen as m (m.id)}
          <li>
            <Avatar name={m.displayName} jersey={m.jersey} size={28} />
            <span class="grow">{m.displayName}</span>
            <small class="subtle">{ago(seenMap.get(m.id) ?? 0)}</small>
          </li>
        {/each}
      </ul>
    {/if}
  {:else}
    <p class="subtle" aria-busy="true">Loading…</p>
  {/if}
</section>

<style>
  .seen {
    padding: var(--s-4);
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--s-3);
    margin-bottom: var(--s-2);
  }
  h2 {
    font-size: var(--t-16);
    margin: 0;
  }
  h3 {
    margin: var(--s-3) 0 var(--s-2);
  }
  .people {
    display: flex;
    flex-direction: column;
    gap: 6px;
    max-height: 320px;
    overflow: auto;
  }
  .people li {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    font-size: var(--t-14);
  }
  .all {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    color: var(--ok);
    font-weight: 600;
  }
  .all :global(svg) {
    width: 18px;
    height: 18px;
  }
</style>
