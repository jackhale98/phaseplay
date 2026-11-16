<!-- Create/edit team details with a live crest preview. -->
<script lang="ts">
  import { initials, type Format, type TeamColors } from '@phaseplay/shared';
  import Field from './Field.svelte';
  import Segmented from './Segmented.svelte';
  import Crest from './Crest.svelte';
  import Button from './Button.svelte';

  export type TeamFormValue = {
    name: string;
    shortName: string;
    colors: TeamColors;
    defaultFormat: Format;
    timezone: string;
  };
  type Props = {
    value?: Partial<TeamFormValue>;
    submitLabel: string;
    busy?: boolean;
    onsubmit: (v: TeamFormValue) => void;
  };
  let { value = {}, submitLabel, busy = false, onsubmit }: Props = $props();

  const PRESETS: TeamColors[] = [
    { primary: '#1f6f43', secondary: '#f2c230' },
    { primary: '#12284c', secondary: '#e4002b' },
    { primary: '#7a003c', secondary: '#f5b700' },
    { primary: '#000000', secondary: '#ffffff' },
    { primary: '#005eb8', secondary: '#ffd100' },
    { primary: '#c8102e', secondary: '#ffffff' },
    { primary: '#4b2e83', secondary: '#b7a57a' },
    { primary: '#00843d', secondary: '#000000' },
  ];

  // Initial values only: the parent re-keys this form when the team changes.
  // svelte-ignore state_referenced_locally
  let name = $state(value.name ?? '');
  let short = $state(value.shortName ?? '');
  let shortTouched = $state(!!value.shortName);
  let colors = $state<TeamColors>(value.colors ?? PRESETS[0]!);
  let format = $state<Format>(value.defaultFormat ?? '15s');
  const localTz =
    typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'UTC';
  let timezone = $state(value.timezone ?? localTz);
  const zones =
    typeof Intl !== 'undefined' && 'supportedValuesOf' in Intl
      ? Intl.supportedValuesOf('timeZone')
      : [localTz];
  let error = $state<string | null>(null);

  const autoShort = $derived(initials(name || 'Team', 4).slice(0, 4));
  const shortName = $derived((shortTouched ? short : autoShort).toUpperCase().slice(0, 4));

  function submit(e: SubmitEvent) {
    e.preventDefault();
    if (!name.trim()) return (error = 'Give your team a name');
    onsubmit({
      name: name.trim(),
      shortName: shortName || 'TEAM',
      colors,
      defaultFormat: format,
      timezone,
    });
  }
</script>

<form class="tf" onsubmit={submit} novalidate>
  <div class="preview" style:--p={colors.primary} style:--s={colors.secondary}>
    <Crest {colors} text={shortName || 'TEAM'} size={64} />
    <div>
      <strong>{name || 'Your team'}</strong>
      <span class="muted">{format} · {timezone}</span>
    </div>
  </div>
  <Field label="Team name" {error}>
    {#snippet children({ id, describedby })}
      <input
        {id}
        aria-describedby={describedby}
        bind:value={name}
        maxlength="60"
        placeholder="e.g. Riverside Women RFC"
      />
    {/snippet}
  </Field>
  <Field label="Short name" hint="Up to 4 letters, used on the crest and exports">
    {#snippet children({ id, describedby })}
      <input
        {id}
        aria-describedby={describedby}
        value={shortName}
        maxlength="4"
        oninput={(e) => {
          shortTouched = true;
          short = e.currentTarget.value;
        }}
      />
    {/snippet}
  </Field>
  <fieldset>
    <legend>Team colours</legend>
    <div class="swatches">
      {#each PRESETS as p (p.primary + p.secondary)}
        <button
          type="button"
          class="sw"
          class:on={p.primary === colors.primary && p.secondary === colors.secondary}
          aria-label="Primary {p.primary}, secondary {p.secondary}"
          aria-pressed={p.primary === colors.primary && p.secondary === colors.secondary}
          style:--p={p.primary}
          style:--s={p.secondary}
          onclick={() => (colors = { ...p })}
        ></button>
      {/each}
    </div>
    <div class="custom">
      <label>Primary <input type="color" bind:value={colors.primary} /></label>
      <label>Secondary <input type="color" bind:value={colors.secondary} /></label>
    </div>
  </fieldset>
  <div class="field-like">
    <span class="lbl" id="fmt-l">Usual format</span>
    <Segmented
      label="Usual format"
      bind:value={format}
      options={[
        { value: '15s', label: '15s' },
        { value: '7s', label: '7s' },
      ]}
    />
  </div>
  <Field label="Timezone" hint="Event times are shown in this timezone">
    {#snippet children({ id, describedby })}
      <select {id} aria-describedby={describedby} bind:value={timezone}>
        {#each zones as z (z)}<option value={z}>{z.replace(/_/g, ' ')}</option>{/each}
      </select>
    {/snippet}
  </Field>
  <Button type="submit" variant="primary" size="lg" block loading={busy}>{submitLabel}</Button>
</form>

<style>
  .tf {
    display: grid;
    gap: var(--s-5);
  }
  .preview {
    display: flex;
    gap: var(--s-4);
    align-items: center;
    padding: var(--s-4);
    border-radius: var(--r-lg);
    background: linear-gradient(
      135deg,
      color-mix(in srgb, var(--p) 14%, var(--surface)),
      var(--surface)
    );
    border: 1px solid var(--border);
  }
  .preview strong {
    display: block;
    font-size: var(--t-20);
    letter-spacing: -0.02em;
  }
  .preview span {
    font-size: var(--t-14);
  }
  fieldset {
    border: 0;
    margin: 0;
    padding: 0;
  }
  legend,
  .lbl {
    font-size: var(--t-14);
    font-weight: 650;
    margin-bottom: 6px;
    display: block;
  }
  .swatches {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-2);
  }
  .sw {
    width: 44px;
    height: 44px;
    border-radius: 50%;
    border: 2px solid var(--surface);
    background: linear-gradient(135deg, var(--p) 0 55%, var(--s) 55% 100%);
    box-shadow: 0 0 0 1px var(--border-strong);
  }
  .sw.on {
    box-shadow: 0 0 0 3px var(--text);
  }
  .custom {
    display: flex;
    gap: var(--s-4);
    margin-top: var(--s-3);
    font-size: var(--t-14);
    color: var(--text-2);
  }
  .custom label {
    display: inline-flex;
    align-items: center;
    gap: var(--s-2);
  }
  .custom input {
    width: 44px;
    height: 32px;
    border: 1px solid var(--border-strong);
    border-radius: var(--r-sm);
    padding: 2px;
    background: var(--surface);
  }
  .field-like {
    display: grid;
    gap: 6px;
    justify-items: start;
  }
</style>
