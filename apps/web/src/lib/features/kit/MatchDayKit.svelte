<!-- Game-day checklist: the kit tagged for games (flags, tees, first-aid box) and who's bringing it. -->
<script lang="ts">
  import { app } from '#lib/data/app.svelte';
  import { matchDayKit, rsvpOf } from '#lib/data/selectors';
  import { IconChecklist } from '#lib/icons';
  import { itemLabel, whereIs } from './meta';

  let { eventId }: { eventId: string } = $props();

  const s = $derived(app.snap);
  const staff = $derived(app.can('availability.view'));
  const list = $derived(matchDayKit(s));
  const storeKey = $derived(`pp:kit-packed:${eventId}`);

  function load(k: string): string[] {
    try {
      return JSON.parse(localStorage.getItem(k) ?? '[]') as string[];
    } catch {
      return [];
    }
  }
  let packed = $derived(load(storeKey));
  function toggle(id: string) {
    packed = packed.includes(id) ? packed.filter((x) => x !== id) : [...packed, id];
    try {
      localStorage.setItem(storeKey, JSON.stringify(packed));
    } catch {}
  }
  /** Staff can see when the person bringing it isn't coming. */
  const notComing = (holder: string | null) => {
    if (!staff || !holder) return false;
    const r = rsvpOf(s, eventId, holder)?.status ?? null;
    return r === 'no' || r === null;
  };
</script>

{#if list.length}
  <section class="card md" aria-labelledby="md-h-{eventId}">
    <h2 id="md-h-{eventId}" class="h">
      <IconChecklist />Match-day kit
      <span class="subtle"
        >{packed.filter((id) => list.some((i) => i.id === id)).length}/{list.length} ready</span
      >
    </h2>
    <ul class="list">
      {#each list as i (i.id)}
        <li>
          <label class:done={packed.includes(i.id)}>
            <input type="checkbox" checked={packed.includes(i.id)} onchange={() => toggle(i.id)} />
            <span class="grow">
              <strong>{itemLabel(i)}</strong>
              <small
                >{i.status === 'with_someone' ? `${whereIs(s, i)} is bringing it` : whereIs(s, i)}
                {#if notComing(i.holderMemberId)}<span class="warn">
                    · not down as coming</span
                  >{/if}</small
              >
            </span>
          </label>
        </li>
      {/each}
    </ul>
  </section>
{/if}

<style>
  .md {
    padding: var(--s-4) var(--s-5);
  }
  .h {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    font-size: var(--t-16);
    margin-bottom: var(--s-2);
  }
  .h :global(svg) {
    width: 18px;
    height: 18px;
  }
  .h .subtle {
    margin-left: auto;
    font-weight: 400;
  }
  label {
    display: flex;
    gap: var(--s-3);
    align-items: center;
    min-height: 48px;
    padding: var(--s-1) 0;
    border-bottom: 1px solid var(--border);
  }
  li:last-child label {
    border-bottom: 0;
  }
  input {
    width: 22px;
    height: 22px;
    accent-color: var(--accent);
    flex: none;
  }
  small {
    display: block;
    color: var(--text-2);
    font-size: var(--t-14);
  }
  .done strong {
    text-decoration: line-through;
    color: var(--text-2);
  }
  .warn {
    color: var(--warn);
    font-weight: 600;
  }
</style>
