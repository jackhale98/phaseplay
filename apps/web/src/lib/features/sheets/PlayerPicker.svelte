<!--
  Pick a player for a slot: a bottom sheet on phones, a dialog on desktop. Ranked by position fit
  then availability. Keyboard: type to search, arrow keys move, Enter assigns, Escape closes.
-->
<script lang="ts">
  import type { Member } from '@phaseplay/shared';
  import Sheet from '#lib/components/Sheet.svelte';
  import Badge from './Badge.svelte';
  import Avatar from '#lib/components/Avatar.svelte';
  import Button from '#lib/components/Button.svelte';
  import { IconSearch, IconTrash, IconStar } from '#lib/icons';
  import {
    AVAIL_LABEL,
    AVAIL_TONE,
    fitLabel,
    fitTone,
    rankFor,
    slotLabel,
    type Avail,
    type Draft,
  } from './model';
  import { positionsFor } from '@phaseplay/shared';

  type Props = {
    open: boolean;
    slot: number;
    draft: Draft;
    members: Member[];
    availOf: (id: string) => Avail;
    nameOf: (id: string) => string;
    announce?: string;
    onpick: (memberId: string) => void;
    onclear: () => void;
    oncaptain: () => void;
    onvice: () => void;
  };
  let {
    open = $bindable(),
    slot,
    draft,
    members,
    availOf,
    nameOf,
    announce = '',
    onpick,
    onclear,
    oncaptain,
    onvice,
  }: Props = $props();

  const uid = `pk-${Math.random().toString(36).slice(2, 7)}`;
  let query = $state('');
  let active = $state(0);
  let input: HTMLInputElement | undefined = $state();

  const current = $derived(draft.slots[String(slot)] ?? null);
  const list = $derived(rankFor(draft, slot, members, availOf, query));
  const title = $derived(`${slot} · ${slotLabel(draft.format, slot)}`);
  const activeId = $derived.by(() => {
    const c = list[active];
    return c ? `${uid}-${c.member.id}` : undefined;
  });
  const shorts = (m: Member) =>
    m.positions
      .map((n) => positionsFor('15s').find((p) => p.n === n)?.short ?? String(n))
      .join(' · ');

  // New slot: reset the search and move the highlight to the top pick.
  $effect(() => {
    void slot;
    query = '';
    active = 0;
    if (open && input && !matchMedia('(pointer: coarse)').matches) input.focus();
  });
  $effect(() => {
    if (active >= list.length) active = Math.max(0, list.length - 1);
  });
  $effect(() => {
    const c = list[active];
    if (open && c)
      document.getElementById(`${uid}-${c.member.id}`)?.scrollIntoView({ block: 'nearest' });
  });

  function focusInput(node: HTMLInputElement) {
    input = node;
    if (!matchMedia('(pointer: coarse)').matches) requestAnimationFrame(() => node.focus());
  }

  function key(e: KeyboardEvent) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const d = e.key === 'ArrowDown' ? 1 : -1;
      if (list.length) active = (active + d + list.length) % list.length;
    } else if (e.key === 'Home' && !query) {
      e.preventDefault();
      active = 0;
    } else if (e.key === 'End' && !query) {
      e.preventDefault();
      active = Math.max(0, list.length - 1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const c = list[active];
      if (c) onpick(c.member.id);
    }
  }
</script>

<Sheet bind:open {title} description="Best fit first, then who's available." size="md">
  <div class="picker">
    {#if current}
      <div class="now card">
        <Avatar name={nameOf(current)} size={32} />
        <span class="grow truncate"><strong>{nameOf(current)}</strong></span>
        <div class="row acts">
          <Button
            size="sm"
            variant={draft.captainId === current ? 'primary' : 'secondary'}
            aria-pressed={draft.captainId === current}
            onclick={oncaptain}
          >
            {#snippet icon()}<IconStar />{/snippet}Captain
          </Button>
          <Button
            size="sm"
            variant={draft.viceId === current ? 'primary' : 'secondary'}
            aria-pressed={draft.viceId === current}
            onclick={onvice}>Vice</Button
          >
          <Button
            size="sm"
            variant="ghost"
            onclick={onclear}
            aria-label="Remove {nameOf(current)} from {slot}"
          >
            {#snippet icon()}<IconTrash />{/snippet}Remove
          </Button>
        </div>
      </div>
    {/if}

    <div class="search">
      <IconSearch />
      <input
        use:focusInput
        type="search"
        role="combobox"
        aria-label="Search players"
        aria-expanded="true"
        aria-controls="{uid}-list"
        aria-autocomplete="list"
        aria-activedescendant={activeId}
        placeholder="Search the squad"
        autocomplete="off"
        bind:value={query}
        onkeydown={key}
      />
    </div>

    <ul id="{uid}-list" class="opts" role="listbox" aria-label="Players for {title}">
      {#each list as c, i (c.member.id)}
        <!-- Keyboard selection happens through the search box (aria-activedescendant). -->
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <li
          id="{uid}-{c.member.id}"
          role="option"
          aria-selected={i === active}
          class:active={i === active}
          class:here={c.at === slot}
          onclick={() => onpick(c.member.id)}
          onpointermove={() => (active = i)}
        >
          <Avatar name={c.member.displayName} jersey={c.member.jersey} size={36} />
          <span class="who grow">
            <strong class="truncate">{c.member.displayName}</strong>
            <small class="truncate"
              >{c.member.status === 'pending' ? 'Not joined · ' : ''}{shorts(c.member) ||
                'No positions set'}{c.at !== null
                ? ` · ${c.at === slot ? 'Here now' : `On sheet at ${c.at}`}`
                : ''}</small
            >
          </span>
          <span class="chips">
            <Badge tone={fitTone(c.fit)}>{fitLabel(draft.format, slot, c.fit)}</Badge>
            <Badge tone={AVAIL_TONE[c.avail]}>{AVAIL_LABEL[c.avail]}</Badge>
          </span>
        </li>
      {:else}
        <li class="none" role="option" aria-selected="false" aria-disabled="true">
          No one matches “{query}”
        </li>
      {/each}
    </ul>
    <p class="sr-only" aria-live="polite">{announce}</p>
  </div>
</Sheet>

<style>
  .picker {
    display: flex;
    flex-direction: column;
    gap: var(--s-3);
  }
  .now {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--s-2) var(--s-3);
    padding: var(--s-3);
    box-shadow: none;
    background: var(--surface-2);
  }
  .acts {
    gap: var(--s-2);
  }
  .search {
    position: sticky;
    top: calc(-1 * var(--s-2));
    z-index: 1;
    display: flex;
    align-items: center;
    gap: var(--s-2);
    padding: 0 var(--s-3);
    border-radius: var(--r-md);
    border: 1px solid var(--border-strong);
    background: var(--surface);
  }
  .search :global(svg) {
    width: 18px;
    height: 18px;
    color: var(--text-3);
    flex: none;
  }
  .search input {
    flex: 1;
    min-width: 0;
    height: 46px;
    border: 0;
    background: transparent;
    outline: none;
  }
  .search:focus-within {
    outline: 3px solid color-mix(in srgb, var(--accent) 70%, var(--text));
    outline-offset: 1px;
  }
  .opts {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  [role='option'] {
    display: flex;
    align-items: center;
    gap: var(--s-3);
    min-height: 56px;
    padding: var(--s-2) var(--s-3);
    border-radius: var(--r-md);
    cursor: pointer;
  }
  [role='option'].active {
    background: var(--accent-soft);
    box-shadow: inset 3px 0 0 var(--accent);
  }
  .here {
    background: var(--surface-2);
  }
  .who {
    display: flex;
    flex-direction: column;
    line-height: 1.25;
  }
  .who small {
    color: var(--text-3);
    font-size: var(--t-12);
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 4px;
    max-width: 50%;
  }
  .none {
    justify-content: center;
    color: var(--text-2);
    cursor: default;
  }
</style>
