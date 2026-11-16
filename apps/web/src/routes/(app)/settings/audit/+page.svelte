<script lang="ts">
  import { onMount } from 'svelte';
  import type { AuditEntry } from '@phaseplay/shared';
  import { api } from '#lib/api';
  import { app } from '#lib/data/app.svelte';
  import { teamPath } from '#lib/data/actions';
  import Button from '#lib/components/Button.svelte';
  import { dateTime } from '#lib/format';
  import { IconBack } from '#lib/icons';

  let entries = $state<AuditEntry[]>([]);
  let done = $state(false);
  let error = $state<string | null>(null);
  const tz = $derived(app.team?.timezone ?? 'UTC');

  async function more() {
    try {
      const before = entries.at(-1)?.at ?? Date.now() + 1;
      const r = await api<{ entries: AuditEntry[] }>(teamPath(`/audit?before=${before}`));
      entries = [...entries, ...r.entries];
      done = r.entries.length < 50;
    } catch {
      error = "Couldn't load the audit log. Are you online?";
    }
  }
  onMount(more);

  const LABELS: Record<string, (e: AuditEntry) => string> = {
    'team.created': () => 'created the team',
    'team.transferred': (e) => `transferred ownership to ${e.meta?.to ?? 'someone'}`,
    'team.imported': (e) => `imported ${e.meta?.events ?? 0} events and ${e.meta?.members ?? 0} names`,
    'member.joined': (e) => `joined as ${e.meta?.role ?? 'player'}`,
    'member.left': (e) => `${e.meta?.name ?? 'someone'} left`,
    'member.removed': (e) => `removed ${e.meta?.name ?? 'a member'}`,
    'member.role_changed': (e) => `changed ${e.meta?.name}'s role from ${e.meta?.from} to ${e.meta?.to}`,
    'member.relink_issued': (e) => `made a device link for ${e.meta?.name}`,
    'member.relinked': () => 'added a passkey with a device link',
    'invite.created': (e) => `created a ${e.meta?.role} invite`,
    'invite.revoked': () => 'revoked an invite',
    'play.deleted': (e) => `deleted the play “${e.meta?.title}”`,
    'event.deleted': (e) => `deleted “${e.meta?.title}”`,
    'event.cancelled': (e) => `cancelled “${e.meta?.title}”`,
    'event.restored': (e) => `restored “${e.meta?.title}”`,
    'sheet.published': () => 'published a team sheet',
  };
</script>

<svelte:head><title>Audit log · Phaseplay</title></svelte:head>

<div class="page narrow">
  <a class="back" href="/more"><IconBack /> More</a>
  <h1>Audit log</h1>
  <p class="muted lede">Joins, removals, role changes, invites and deletions.</p>
  {#if error}<p class="muted">{error}</p>{/if}
  <ol class="list log">
    {#each entries as e (e.id)}
      <li>
        <span class="t subtle tnum">{dateTime(e.at, tz)}</span>
        <span><strong>{e.actorName ?? 'Someone'}</strong> {(LABELS[e.action] ?? (() => e.action))(e)}</span>
      </li>
    {/each}
  </ol>
  {#if !done && entries.length}<Button onclick={more}>Load more</Button>{/if}
</div>

<style>
  .narrow {
    max-width: 720px;
  }
  .back {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: 44px;
    font-weight: 600;
    text-decoration: none;
  }
  .back :global(svg) {
    width: 18px;
    height: 18px;
  }
  h1 {
    margin-top: var(--s-2);
  }
  .lede {
    margin: var(--s-2) 0 var(--s-5);
  }
  .log li {
    display: grid;
    gap: 2px;
    padding: var(--s-3) 0;
    border-bottom: 1px solid var(--border);
  }
</style>
