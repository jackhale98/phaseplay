<script lang="ts">
  /**
   * "What each role can do": the team's base-role settings (PLAN.md §2). Laptop: a table with a
   * column of switches per configurable role. Phone: the same table showing one column, picked
   * with a Segmented control, so there is only ever one set of inputs. Admins edit, everyone else
   * reads. Saving goes through a one-step confirm that spells out what changes.
   */
  import {
    CONFIGURABLE,
    CONFIGURABLE_FOR,
    CONFIGURABLE_ROLES,
    PERMISSION_AREAS,
    PERMISSION_INFO,
    permissionPhrase,
    ROLE_LABELS,
    ROLE_PRESETS,
    ROLE_PRESET_IDS,
    presetOf,
    rolePermissionsOf,
    sameRolePermissions,
    setRoleAction,
    type Action,
    type ConfigurableRole,
    type RolePermissions,
    type RolePreset,
  } from '@phaseplay/shared';
  import { api, ApiError } from '#lib/api';
  import { app } from '#lib/data/app.svelte';
  import { teamPath } from '#lib/data/actions';
  import Button from '#lib/components/Button.svelte';
  import Segmented from '#lib/components/Segmented.svelte';
  import Sheet from '#lib/components/Sheet.svelte';
  import { toasts } from '#lib/stores/toast.svelte';
  import { IconLock, IconReset } from '#lib/icons';

  const PLURAL: Record<ConfigurableRole, string> = {
    coach: 'Coaches',
    manager: 'Managers',
    player: 'Players',
  };
  const PRESET_HINTS: Record<RolePreset, string> = {
    default: 'Coaches run the team, including the squad and invites. Managers help with logistics.',
    club: 'A committee runs the club. Coaches run games and practices; managers look after the squad and invites.',
  };
  const areas = PERMISSION_AREAS.map((area) => ({
    area,
    items: CONFIGURABLE.filter((a) => PERMISSION_INFO[a].area === area),
  })).filter((g) => g.items.length);

  const editable = $derived(app.can('roles.manage') && !app.demo);
  const saved = $derived(rolePermissionsOf(app.team?.rolePermissions));
  let draft = $state<RolePermissions>(structuredClone($state.snapshot(rolePermissionsOf(null))));
  let touched = $state(false);
  let column = $state<ConfigurableRole>('coach');
  let confirm = $state(false);
  let busy = $state(false);
  let announce = $state('');

  // Follow the saved settings until the admin starts editing (and again after a save or discard).
  $effect(() => {
    const s = saved;
    if (!touched) draft = structuredClone($state.snapshot(s));
  });
  const dirty = $derived(!sameRolePermissions(draft, saved));
  const preset = $derived(presetOf(draft));
  const presetChoice = $derived<RolePreset | 'custom'>(preset ?? 'custom');

  function applyPreset(p: RolePreset) {
    draft = structuredClone($state.snapshot(ROLE_PRESETS[p].permissions)) as RolePermissions;
    touched = true;
    announce = `${ROLE_PRESETS[p].label} settings. Save to apply them.`;
  }
  function toggle(role: ConfigurableRole, action: Action, on: boolean) {
    const before = draft[role];
    const next = setRoleAction(role, before, action, on);
    draft = { ...draft, [role]: next };
    touched = true;
    const also = on
      ? next.filter((a) => a !== action && !before.includes(a))
      : before.filter((a) => a !== action && !next.includes(a));
    announce = also.length
      ? `Also turned ${on ? 'on' : 'off'} for ${PLURAL[role].toLowerCase()}: ${also.map((a) => PERMISSION_INFO[a].label).join(', ')}`
      : '';
  }
  function discard() {
    touched = false;
    draft = structuredClone($state.snapshot(saved));
    announce = '';
  }

  const list = (r: ConfigurableRole, xs: Action[]) =>
    xs.map((a) => permissionPhrase(r, a)).join(', ');
  const changes = $derived(
    CONFIGURABLE_ROLES.flatMap((r) => {
      const lost = saved[r].filter((a) => !draft[r].includes(a));
      const gained = draft[r].filter((a) => !saved[r].includes(a));
      return [
        ...(lost.length
          ? [
              {
                key: `${r}-lost`,
                text: `${PLURAL[r]} will no longer be able to: ${list(r, lost)}.`,
              },
            ]
          : []),
        ...(gained.length
          ? [{ key: `${r}-gained`, text: `${PLURAL[r]} will now be able to: ${list(r, gained)}.` }]
          : []),
      ];
    }),
  );

  async function save() {
    busy = true;
    try {
      await api(teamPath('/role-permissions'), {
        method: 'PUT',
        body: $state.snapshot(draft),
        // Old cached team data has no version: then save without the check.
        ifMatch: app.team?.rolePermissionsVersion ?? null,
      });
      await app.sync();
      confirm = false;
      touched = false;
      toasts.success('Role settings saved');
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        // Someone else saved first: show theirs and let this admin decide again.
        await app.sync();
        confirm = false;
        touched = false;
        announce = '';
        toasts.error(
          'Someone else changed these settings. Showing the latest; check and save again.',
        );
        return;
      }
      toasts.error(err instanceof ApiError ? err.message : 'Could not save the role settings');
    } finally {
      busy = false;
    }
  }
</script>

<section class="base" aria-labelledby="what-h">
  <h2 class="section-title" id="what-h">What each role can do</h2>
  <p class="muted lead">
    Everyone can see the team and reply to events. Choose what else coaches, managers and players
    can do. Team roles above still add to these.
  </p>

  {#if editable}
    <fieldset class="presets">
      <legend>Starting point</legend>
      {#each ROLE_PRESET_IDS as p (p)}
        <label class="preset">
          <input
            type="radio"
            name="role-preset"
            value={p}
            checked={presetChoice === p}
            onchange={() => applyPreset(p)}
            aria-describedby="preset-{p}"
          />
          <span>
            <strong>{ROLE_PRESETS[p].label}{p === 'default' ? ' (default)' : ''}</strong>
            <small class="subtle" id="preset-{p}">{PRESET_HINTS[p]}</small>
          </span>
        </label>
      {/each}
      <label class="preset" class:off={presetChoice !== 'custom'}>
        <input
          type="radio"
          name="role-preset"
          value="custom"
          checked={presetChoice === 'custom'}
          disabled={presetChoice !== 'custom'}
          aria-describedby="preset-custom"
        />
        <span>
          <strong>Custom</strong>
          <small class="subtle" id="preset-custom"
            >{presetChoice === 'custom'
              ? 'Your own mix of the switches below.'
              : 'Change any switch below to make your own mix.'}</small
          >
        </span>
      </label>
      {#if presetChoice === 'custom'}
        <div>
          <Button size="sm" onclick={() => applyPreset('default')}
            >{#snippet icon()}<IconReset />{/snippet}Reset to default</Button
          >
        </div>
      {/if}
    </fieldset>
  {:else}
    <p class="card using">
      This team uses
      <strong>{preset ? ROLE_PRESETS[preset].label : 'its own custom settings'}</strong>. Only
      admins can change it.
    </p>
  {/if}

  <p class="locked card">
    <IconLock />
    <span
      ><strong>Owner: everything. Admin: everything except deleting the team.</strong>
      <span class="subtle">Always, and it can't be changed here.</span></span
    >
  </p>

  <div class="pick">
    <Segmented
      label="Show the settings for"
      bind:value={column}
      options={CONFIGURABLE_ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] }))}
    />
  </div>

  <div class="card table-wrap">
    <table data-show={column}>
      <caption class="sr-only">What coaches, managers and players can do</caption>
      <thead>
        <tr>
          <th scope="col"><span class="sr-only">Permission</span></th>
          {#each CONFIGURABLE_ROLES as r (r)}
            <th scope="col" class="role col-{r}">{ROLE_LABELS[r]}</th>
          {/each}
        </tr>
      </thead>
      {#each areas as g (g.area)}
        <tbody>
          <tr class="area">
            <th scope="colgroup" colspan="4">{g.area}</th>
          </tr>
          {#each g.items as a (a)}
            {@const info = PERMISSION_INFO[a]}
            <tr>
              <th scope="row" class="perm">
                <span class="label">{info.label}</span>
                {#if info.hint}<small class="subtle" id="hint-{a}">{info.hint}</small>{/if}
              </th>
              {#each CONFIGURABLE_ROLES as r (r)}
                {@const on = draft[r].includes(a)}
                <td class="cell col-{r}">
                  {#if !CONFIGURABLE_FOR[r].includes(a)}
                    <span aria-hidden="true" class="na">—</span>
                    <span class="sr-only">{info.label}: not available for players</span>
                  {:else if editable}
                    <input
                      type="checkbox"
                      role="switch"
                      class="switch"
                      checked={on}
                      aria-label="{ROLE_LABELS[r]}: {info.label}"
                      aria-describedby={info.hint ? `hint-${a}` : undefined}
                      onchange={(e) => toggle(r, a, e.currentTarget.checked)}
                    />
                  {:else}
                    <span class="ro" class:yes={on}
                      >{on ? 'Yes' : 'No'}<span class="sr-only">
                        for {PLURAL[r].toLowerCase()}: {info.label}</span
                      ></span
                    >
                  {/if}
                </td>
              {/each}
            </tr>
          {/each}
        </tbody>
      {/each}
    </table>
  </div>
  <p class="sr-only" aria-live="polite">{announce}</p>

  {#if editable && dirty}
    <div class="bar" role="group" aria-label="Unsaved role settings">
      <span class="grow">You have unsaved changes.</span>
      <Button variant="ghost" onclick={discard}>Discard</Button>
      <Button variant="primary" onclick={() => (confirm = true)}>Save changes</Button>
    </div>
  {/if}
</section>

<Sheet bind:open={confirm} title="Change what roles can do?" size="sm">
  <ul class="changes">
    {#each changes as c (c.key)}<li>{c.text}</li>{/each}
  </ul>
  <p class="subtle">It applies to everyone with that role straight away.</p>
  {#snippet footer()}
    <span class="grow"></span>
    <Button variant="ghost" onclick={() => (confirm = false)}>Cancel</Button>
    <Button variant="primary" loading={busy} disabled={busy} onclick={save}>Save changes</Button>
  {/snippet}
</Sheet>

<style>
  .lead {
    margin: 0 0 var(--s-4);
  }
  fieldset {
    border: 0;
    margin: 0 0 var(--s-4);
    padding: 0;
    display: grid;
    gap: var(--s-1);
  }
  legend {
    font-weight: 700;
    font-size: var(--t-14);
    margin-bottom: var(--s-2);
  }
  .preset {
    display: flex;
    align-items: flex-start;
    gap: var(--s-3);
    min-height: 44px;
    padding: var(--s-2) 0;
    cursor: pointer;
  }
  .preset.off {
    cursor: default;
  }
  .preset input {
    /* 24 px meets WCAG target size on its own, whatever sits nearby (e.g. a toast). */
    width: 24px;
    height: 24px;
    margin: 0;
    flex: none;
    accent-color: var(--sel);
  }
  .preset span {
    display: grid;
    gap: 2px;
  }
  .using,
  .locked {
    margin: 0 0 var(--s-4);
    padding: var(--s-3) var(--s-4);
  }
  .locked {
    display: flex;
    gap: var(--s-3);
    align-items: center;
  }
  .locked :global(svg) {
    width: 20px;
    height: 20px;
    flex: none;
  }
  .pick {
    margin-bottom: var(--s-3);
  }
  .table-wrap {
    overflow: hidden;
  }
  table {
    width: 100%;
    border-collapse: collapse;
  }
  th,
  td {
    text-align: left;
    padding: var(--s-2) var(--s-4);
  }
  thead th {
    font-size: var(--t-14);
    border-bottom: 1px solid var(--border);
  }
  .role,
  .cell {
    text-align: center;
    width: 112px;
  }
  .area th {
    background: var(--surface-2);
    font-size: var(--t-14);
    font-weight: 700;
    padding-top: var(--s-3);
  }
  tbody tr + tr td,
  tbody tr + tr th {
    border-top: 1px solid var(--border);
  }
  .perm {
    font-weight: 400;
  }
  .perm .label {
    display: block;
    font-weight: 600;
  }
  .perm small {
    display: block;
    font-size: var(--t-12);
  }
  .na {
    color: var(--text-3);
  }
  .ro {
    font-size: var(--t-14);
    color: var(--text-2);
  }
  .ro.yes {
    font-weight: 700;
    color: var(--text);
  }
  /* Phone: one role's column at a time. */
  @media (max-width: 767px) {
    .role {
      display: none;
    }
    table:not([data-show='coach']) .col-coach,
    table:not([data-show='manager']) .col-manager,
    table:not([data-show='player']) .col-player {
      display: none;
    }
    .role,
    .cell {
      width: 72px;
    }
    th,
    td {
      padding: var(--s-2) var(--s-3);
    }
  }
  @media (min-width: 768px) {
    .pick {
      display: none;
    }
  }
  .switch {
    appearance: none;
    position: relative;
    width: 48px;
    height: 28px;
    margin: 8px 0;
    border-radius: 999px;
    background: var(--border-strong);
    cursor: pointer;
    vertical-align: middle;
    transition: background 0.15s;
  }
  .switch::after {
    content: '';
    position: absolute;
    top: 3px;
    left: 3px;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    background: var(--surface);
    box-shadow: 0 1px 2px rgb(0 0 0 / 0.25);
    transition: transform 0.15s;
  }
  .switch:checked {
    background: var(--sel);
  }
  .switch:checked::after {
    transform: translateX(20px);
  }
  .switch:focus-visible {
    outline: 2px solid var(--focus, var(--accent));
    outline-offset: 2px;
  }
  @media (prefers-reduced-motion: reduce) {
    .switch,
    .switch::after {
      transition: none;
    }
  }
  .bar {
    position: sticky;
    bottom: calc(var(--tabbar-h, 0px) + var(--s-3));
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--s-2);
    margin-top: var(--s-4);
    padding: var(--s-3) var(--s-4);
    border-radius: var(--r-lg);
    background: var(--surface);
    border: 1px solid var(--border-strong);
    box-shadow: 0 4px 16px rgb(0 0 0 / 0.12);
  }
  .grow {
    flex: 1;
  }
  .changes {
    margin: 0 0 var(--s-3);
    padding-left: var(--s-5);
    display: grid;
    gap: var(--s-2);
  }
</style>
