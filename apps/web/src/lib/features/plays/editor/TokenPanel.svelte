<!-- Properties of one token: number, label, group, squad link, size, and how it moves this frame. -->
<script lang="ts">
  import type { Entity, Member, Play } from '@phaseplay/shared';
  import { resolvedBall } from '@phaseplay/diagram/sample';
  import { grass, textOn } from '@phaseplay/diagram/themes';
  import Button from '#lib/components/Button.svelte';
  import { IconCopy, IconTrash, IconUndo } from '#lib/icons';
  import { entityLabel } from '../describe';
  import { clearMove, giveBall, hasMove, isPerson, setMove, updateEntity } from '../ops';

  type Props = {
    play: Play;
    fi: number;
    id: string;
    members: Member[];
    apply: (fn: (p: Play) => Play, label: string) => void;
    onduplicate: () => void;
    ondelete: () => void;
  };
  let { play, fi, id, members, apply, onduplicate, ondelete }: Props = $props();
  const e = $derived(play.entities.find((x) => x.id === id) as Entity | undefined);
  const move = $derived(fi > 0 ? play.frames[fi]?.moves[id] : undefined);
  const holder = $derived(resolvedBall(play, fi)?.holder);
  const numbered = $derived(
    !!e && (e.kind === 'attack' || e.kind === 'defence' || e.kind === 'player'),
  );
  const sized = $derived(
    !!e &&
      (e.kind === 'zone' || e.kind === 'gate' || e.kind === 'ladder' || e.kind === 'scrum_machine'),
  );
  const texted = $derived(
    !!e && (e.kind === 'zone' || e.kind === 'label' || e.kind === 'attack' || e.kind === 'defence'),
  );
  const uid = `tp-${Math.random().toString(36).slice(2, 7)}`;

  const num = (v: string) => {
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : undefined;
  };
  function setSize(k: 'w' | 'h' | 'rot', v: string) {
    if (!e) return;
    const n = Number(v);
    if (!Number.isFinite(n)) return;
    const size = {
      w: e.size?.w ?? 5,
      h: e.size?.h ?? 5,
      ...(e.size?.rot !== undefined ? { rot: e.size.rot } : {}),
    };
    const val =
      k === 'rot' ? Math.round(n) % 360 : Math.max(0.5, Math.min(100, Math.round(n * 2) / 2));
    apply((p) => updateEntity(p, id, { size: { ...size, [k]: val } }), 'Resize');
  }
</script>

{#if e}
  <div class="tp">
    <h3>{entityLabel(e)}</h3>
    <div class="grid">
      {#if numbered}
        <label for="{uid}-n">Number</label>
        <input
          id="{uid}-n"
          type="number"
          inputmode="numeric"
          min="0"
          max="99"
          value={e.number ?? ''}
          onchange={(ev) => {
            const n = num(ev.currentTarget.value);
            apply(
              (p) =>
                updateEntity(p, id, {
                  number: n === undefined ? undefined : Math.max(0, Math.min(99, n)),
                }),
              'Number',
            );
          }}
        />
      {/if}
      {#if texted}
        <label for="{uid}-t">{e.kind === 'zone' || e.kind === 'label' ? 'Text' : 'Role tag'}</label>
        <input
          id="{uid}-t"
          value={e.text ?? ''}
          maxlength={e.kind === 'attack' || e.kind === 'defence' ? 3 : 80}
          placeholder={e.kind === 'attack' || e.kind === 'defence' ? 'J, L…' : ''}
          onchange={(ev) => {
            const v = ev.currentTarget.value.trim();
            apply((p) => updateEntity(p, id, { text: v || undefined }), 'Text');
          }}
        />
      {/if}
      {#if e.kind === 'player'}
        <span class="lbl" id="{uid}-g">Bib</span>
        <div class="groups" role="group" aria-labelledby="{uid}-g">
          {#each ['A', 'B', 'C', 'D'] as const as g (g)}
            <button
              type="button"
              class="g"
              style:background={grass.groups[g]}
              style:color={textOn(grass.groups[g])}
              aria-pressed={e.group === g}
              onclick={() =>
                apply((p) => updateEntity(p, id, { group: e.group === g ? undefined : g }), 'Bib')}
              >{g}</button
            >
          {/each}
        </div>
      {/if}
      {#if isPerson(e.kind) && members.length}
        <label for="{uid}-m">Squad member</label>
        <select
          id="{uid}-m"
          value={e.memberId ?? ''}
          onchange={(ev) => {
            const v = ev.currentTarget.value;
            apply((p) => updateEntity(p, id, { memberId: v || undefined }), 'Link player');
          }}
        >
          <option value="">Nobody</option>
          {#each members as m (m.id)}<option value={m.id}>{m.displayName}</option>{/each}
        </select>
      {/if}
      {#if sized}
        <label for="{uid}-w">Width (m)</label>
        <input
          id="{uid}-w"
          type="number"
          min="0.5"
          max="100"
          step="0.5"
          value={e.size?.w ?? 5}
          onchange={(ev) => setSize('w', ev.currentTarget.value)}
        />
        <label for="{uid}-h">{e.kind === 'gate' ? 'Depth (m)' : 'Length (m)'}</label>
        <input
          id="{uid}-h"
          type="number"
          min="0.5"
          max="120"
          step="0.5"
          value={e.size?.h ?? 5}
          onchange={(ev) => setSize('h', ev.currentTarget.value)}
        />
        <label for="{uid}-r">Rotation (°)</label>
        <input
          id="{uid}-r"
          type="number"
          min="-180"
          max="360"
          step="15"
          value={e.size?.rot ?? 0}
          onchange={(ev) => setSize('rot', ev.currentTarget.value)}
        />
      {/if}
      {#if fi > 0 && e.kind !== 'ball'}
        <label for="{uid}-k">Move</label>
        <select
          id="{uid}-k"
          value={move?.kind ?? 'run'}
          onchange={(ev) => {
            const k = ev.currentTarget.value as 'run' | 'carry';
            apply((p) => setMove(p, fi, id, { kind: k }), 'Move type');
          }}
        >
          <option value="run">Run</option>
          <option value="carry">Carry</option>
        </select>
        <label for="{uid}-d">Start after (s)</label>
        <input
          id="{uid}-d"
          type="number"
          min="0"
          max="20"
          step="0.1"
          value={((move?.delayMs ?? 0) / 1000).toFixed(1)}
          onchange={(ev) => {
            const s = Math.max(0, Number(ev.currentTarget.value) || 0);
            apply((p) => setMove(p, fi, id, { delayMs: Math.round(s * 1000) }), 'Delay');
          }}
        />
        <label for="{uid}-e">Easing</label>
        <select
          id="{uid}-e"
          value={move?.ease ?? 'inOut'}
          onchange={(ev) => {
            const v = ev.currentTarget.value as 'linear' | 'inOut' | 'out';
            apply((p) => setMove(p, fi, id, { ease: v === 'inOut' ? undefined : v }), 'Easing');
          }}
        >
          <option value="inOut">Smooth</option>
          <option value="out">Explosive start</option>
          <option value="linear">Steady</option>
        </select>
      {/if}
    </div>
    <div class="acts">
      {#if isPerson(e.kind) && holder !== id}
        <Button size="sm" onclick={() => apply((p) => giveBall(p, fi, id), 'Give ball')}
          >Give ball</Button
        >
      {/if}
      {#if hasMove(play, fi, id)}
        <Button
          size="sm"
          onclick={() =>
            apply((p) => clearMove(p, fi, id), e.kind === 'ball' ? 'Remove pass' : 'Remove move')}
          >{#snippet icon()}<IconUndo />{/snippet}{e.kind === 'ball'
            ? 'Remove pass or kick'
            : 'Remove this move'}</Button
        >
      {/if}
      {#if fi > 0 && move?.ctrl?.length}
        <Button
          size="sm"
          onclick={() => apply((p) => setMove(p, fi, id, { ctrl: [] }), 'Straighten')}
          >Straighten run</Button
        >
      {/if}
      {#if e.kind !== 'ball'}
        <Button size="sm" onclick={onduplicate}
          >{#snippet icon()}<IconCopy />{/snippet}Duplicate</Button
        >
      {/if}
      <Button size="sm" variant="danger" onclick={ondelete}
        >{#snippet icon()}<IconTrash />{/snippet}{isPerson(e.kind)
          ? 'Delete player'
          : 'Delete'}</Button
      >
    </div>
  </div>
{/if}

<style>
  .tp h3 {
    font-size: var(--t-16);
    margin: 0 0 var(--s-3);
  }
  .grid {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: var(--s-2) var(--s-3);
    align-items: center;
  }
  label,
  .lbl {
    font-size: var(--t-14);
    font-weight: 600;
    color: var(--text-2);
  }
  input,
  select {
    min-height: 44px;
    width: 100%;
    min-width: 0;
    padding: 8px 10px;
    border-radius: var(--r-md);
    border: 1px solid var(--border-strong);
    background: var(--surface);
    font-size: var(--t-16);
  }
  .groups {
    display: flex;
    gap: 6px;
  }
  .g {
    width: 44px;
    height: 44px;
    border-radius: var(--r-full);
    border: 2px solid transparent;
    font-weight: 750;
  }
  .g[aria-pressed='true'] {
    border-color: var(--text);
    box-shadow: 0 0 0 2px var(--surface) inset;
  }
  .acts {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-2);
    margin-top: var(--s-4);
  }
</style>
