<!--
  One sheet slot. On the pitch it's a disc with the number and a name pill; on the bench and in the
  list it's a row. Editable slots are buttons (picker, keyboard, drag and drop via spread props);
  read-only ones are plain text with a full spoken label.
-->
<script lang="ts">
  import type { HTMLButtonAttributes } from 'svelte/elements';
  import type { Format } from '@phaseplay/shared';
  import { shortName, slotLabel, slotShort } from './model';

  type Props = {
    attrs?: HTMLButtonAttributes;
    format: Format;
    n: number;
    name: string | null;
    variant?: 'pitch' | 'row';
    captain?: boolean;
    vice?: boolean;
    flag?: string;
    me?: boolean;
    over?: boolean;
    editable?: boolean;
    detail?: string;
  };
  let {
    format,
    n: slot,
    name,
    variant = 'pitch',
    captain = false,
    vice = false,
    flag,
    me = false,
    over = false,
    editable = false,
    detail,
    attrs = {},
  }: Props = $props();

  const pos = $derived(slotLabel(format, slot));
  const spoken = $derived(
    `${slot}, ${pos}: ${name ?? 'empty'}${captain ? ', captain' : ''}${vice ? ', vice-captain' : ''}${me ? ', you' : ''}${flag ? `, ${flag}` : ''}`,
  );
</script>

{#snippet body()}
  <span class="disc" aria-hidden="true">
    <span class="n tnum">{slot}</span>
    {#if captain}<span class="badge">C</span>{:else if vice}<span class="badge vc">VC</span>{/if}
    {#if flag}<span class="flag">!</span>{/if}
  </span>
  {#if variant === 'pitch'}
    <span class="nm" aria-hidden="true"
      >{name
        ? shortName(name)
        : editable
          ? `Pick ${slotShort(format, slot)}`
          : slotShort(format, slot)}</span
    >
    {#if me}<span class="you" aria-hidden="true">You</span>{/if}
  {:else}
    <span class="txt" aria-hidden="true">
      <strong class:empty={!name}>{name ?? (editable ? 'Pick a player' : 'Not named')}</strong>
      <small>{pos}{detail ? ` · ${detail}` : ''}{flag ? ` · ${flag}` : ''}</small>
    </span>
    {#if me}<span class="you" aria-hidden="true">You</span>{/if}
  {/if}
{/snippet}

{#if editable}
  <button
    type="button"
    class="tok {variant}"
    class:filled={!!name}
    class:flagged={!!flag}
    class:over
    class:me
    data-slot={slot}
    aria-label={spoken}
    draggable={name ? 'true' : 'false'}
    {...attrs}>{@render body()}</button
  >
{:else}
  <div class="tok {variant}" class:filled={!!name} class:me data-slot={slot}>
    <span class="sr-only">{spoken}</span>
    {@render body()}
  </div>
{/if}

<style>
  .tok {
    position: relative;
    border: 0;
    background: transparent;
    color: inherit;
    padding: 0;
    font: inherit;
    text-align: inherit;
  }
  button.tok {
    cursor: pointer;
    touch-action: manipulation;
  }
  /* Pitch variant */
  .pitch {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    width: 100%;
    max-width: 96px;
    min-height: 44px;
    padding: 2px 0;
    border-radius: var(--r-md);
    color: #fff;
  }
  .pitch .disc {
    position: relative;
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    border-radius: 50%;
    border: 2px dashed rgb(255 255 255 / 0.85);
    background: rgb(0 0 0 / 0.18);
    font-weight: 800;
    font-size: var(--t-16);
    transition:
      transform var(--m-fast) var(--ease),
      box-shadow var(--m-fast) var(--ease);
  }
  .pitch.filled .disc {
    border: 3px solid var(--secondary, #f2c230);
    background: #fff;
    color: #0c100d;
    box-shadow: 0 2px 6px rgb(0 0 0 / 0.3);
  }
  .pitch .nm {
    max-width: 100%;
    padding: 1px 7px;
    border-radius: var(--r-full);
    background: rgb(0 0 0 / 0.55);
    color: #fff;
    font-size: var(--t-12);
    font-weight: 650;
    line-height: 1.35;
    text-align: center;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .pitch:not(.filled) .nm {
    background: rgb(0 0 0 / 0.42);
  }
  button.pitch:hover .disc {
    transform: scale(1.06);
  }
  .pitch.over .disc,
  .row.over {
    box-shadow:
      0 0 0 3px #fff,
      0 0 0 6px rgb(0 0 0 / 0.35);
  }
  .pitch.me .disc {
    box-shadow:
      0 0 0 3px #fff,
      0 0 0 7px var(--secondary, #f2c230);
  }
  .badge {
    position: absolute;
    top: -6px;
    right: -8px;
    display: grid;
    place-items: center;
    min-width: 20px;
    height: 20px;
    padding: 0 4px;
    border-radius: var(--r-full);
    background: #0c100d;
    color: #fff;
    font-size: 0.6875rem;
    font-weight: 800;
    border: 2px solid #fff;
  }
  .flag {
    position: absolute;
    bottom: -4px;
    right: -6px;
    display: grid;
    place-items: center;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: #fdb022;
    color: #3b2300;
    font-size: 0.75rem;
    font-weight: 900;
    border: 2px solid #fff;
  }
  .you {
    padding: 0 6px;
    border-radius: var(--r-full);
    background: var(--secondary, #f2c230);
    color: #0c100d;
    font-size: 0.6875rem;
    font-weight: 800;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  /* Row variant (bench and list) */
  .row {
    display: flex;
    align-items: center;
    gap: var(--s-3);
    width: 100%;
    min-height: 56px;
    padding: var(--s-2) var(--s-3);
    border-radius: var(--r-md);
    background: var(--surface);
    border: 1px solid var(--border);
    color: var(--text);
  }
  button.row:hover {
    background: var(--surface-2);
  }
  .row .disc {
    position: relative;
    display: grid;
    place-items: center;
    flex: none;
    width: 38px;
    height: 38px;
    border-radius: 50%;
    border: 2px dashed var(--border-strong);
    color: var(--text-2);
    font-weight: 800;
  }
  .row.filled .disc {
    border: 0;
    background: var(--accent);
    color: var(--on-accent);
  }
  .row .badge {
    top: -5px;
    right: -9px;
  }
  .row.me {
    border-color: var(--accent);
    background: var(--accent-softer);
  }
  .row.flagged {
    border-color: color-mix(in srgb, var(--warn) 50%, var(--border));
  }
  .txt {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
    line-height: 1.25;
  }
  .txt strong {
    font-weight: 650;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .txt strong.empty {
    color: var(--text-2);
    font-weight: 550;
  }
  .txt small {
    color: var(--text-3);
    font-size: var(--t-12);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .row .you {
    flex: none;
  }
  @media (min-width: 768px) {
    .pitch .disc {
      width: 52px;
      height: 52px;
      font-size: var(--t-20);
    }
    .pitch .nm {
      font-size: var(--t-14);
    }
    .pitch {
      max-width: 128px;
    }
  }
</style>
