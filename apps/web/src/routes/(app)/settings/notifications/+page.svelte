<script lang="ts">
  import { onMount } from 'svelte';
  import {
    NOTIFY_TOPICS,
    NOTIFY_TOPIC_INFO,
    sha256Base64Url,
    type NotifyPrefs,
    type NotifyTopic,
  } from '@phaseplay/shared';
  import { ApiError } from '#lib/api';
  import { app } from '#lib/data/app.svelte';
  import Button from '#lib/components/Button.svelte';
  import Loader from '#lib/components/Loader.svelte';
  import { toasts } from '#lib/stores/toast.svelte';
  import { ago } from '#lib/format';
  import { IconBack, IconBell, IconLock, IconWarn } from '#lib/icons';
  import IconSmartphone from '@lucide/svelte/icons/smartphone';
  import IosInstallGuide from '#lib/features/notify/IosInstallGuide.svelte';
  import {
    currentSubscription,
    disablePush,
    dismissPrompt,
    enablePush,
    loadDevices,
    pushSupport,
    savePrefs,
    sendTest,
    PushError,
    type PushDevice,
    type PushSupport,
  } from '#lib/features/notify/push';

  const demo = $derived(app.demo);
  let support = $state<PushSupport | null>(null);
  let thisId = $state<string | null>(null);
  let devices = $state<PushDevice[] | null>(null);
  let busy = $state<'on' | 'off' | 'test' | null>(null);
  let prefs = $state<NotifyPrefs>(
    app.me?.notify ?? { events: true, reminders: true, sheets: true, plays: true, kit: true },
  );
  let saving = $state<NotifyTopic | null>(null);

  const err = (e: unknown, fallback: string) =>
    toasts.error(e instanceof ApiError || e instanceof PushError ? e.message : fallback);

  async function refresh() {
    support = pushSupport();
    // The device list doesn't wait on this device's subscription check (it can be slow).
    const here = (async () => {
      const sub = support === 'ready' ? await currentSubscription().catch(() => null) : null;
      thisId = sub ? await sha256Base64Url(sub.endpoint) : null;
    })();
    try {
      devices = (await loadDevices()).devices;
    } catch (e) {
      devices = devices ?? [];
      err(e, "Couldn't load your devices");
    }
    await here;
  }
  onMount(() => {
    dismissPrompt();
    void refresh();
  });

  const onHere = $derived(!!thisId && !!devices?.some((d) => d.id === thisId));

  async function turnOn() {
    busy = 'on';
    try {
      await enablePush();
      toasts.success('Notifications are on for this device');
      await refresh();
    } catch (e) {
      err(e, "Couldn't turn on notifications");
      support = pushSupport();
    } finally {
      busy = null;
    }
  }
  async function turnOff() {
    busy = 'off';
    try {
      await disablePush();
      toasts.show('Notifications are off for this device');
      await refresh();
    } catch (e) {
      err(e, "Couldn't turn off notifications");
    } finally {
      busy = null;
    }
  }
  async function test() {
    busy = 'test';
    try {
      await sendTest();
      toasts.show('Test sent. It should arrive in a few seconds.');
    } catch (e) {
      err(e, "Couldn't send a test");
    } finally {
      busy = null;
    }
  }
  async function toggle(topic: NotifyTopic, on: boolean) {
    const before = prefs;
    prefs = { ...prefs, [topic]: on };
    saving = topic;
    try {
      prefs = (await savePrefs(prefs)).notify;
      await app.refreshMe();
    } catch (e) {
      prefs = before;
      err(e, "Couldn't save that");
    } finally {
      saving = null;
    }
  }
</script>

<svelte:head><title>Notifications · Phaseplay</title></svelte:head>

<div class="page narrow">
  <a class="back" href="/more"><IconBack /> More</a>
  <header class="page-head">
    <div>
      <h1>Notifications</h1>
      <p class="muted lead">
        Hear about schedule changes, team sheets and reminders on your phone or computer. Turn them
        on for each device, and choose what you hear about.
      </p>
    </div>
  </header>

  {#if demo}
    <p class="card note" role="note">
      <IconLock /> Notifications are off in the demo team. Create your own team to use them.
    </p>
  {/if}

  <h2 class="section-title">This device</h2>
  {#if support === null}
    <Loader label="Checking this device" />
  {:else if support === 'ios-install'}
    <IosInstallGuide />
  {:else}
    <section class="card pad" aria-labelledby="device-h">
      <div class="opt">
        <span class="ic"><IconBell /></span>
        <div class="grow">
          <h3 id="device-h" class="h">
            {onHere ? 'Notifications are on' : 'Notifications are off'}
          </h3>
          <p class="muted" aria-live="polite">
            {#if support === 'unsupported'}
              This browser can't show notifications from web apps. Try Chrome, Edge, Firefox or
              Safari.
            {:else if support === 'denied'}
              Notifications are blocked for Phaseplay. Allow them in your browser's site settings,
              then come back here.
            {:else if onHere}
              This device gets the notifications you choose below.
            {:else}
              Turn them on to get updates on this device.
            {/if}
          </p>
        </div>
      </div>
      {#if support === 'ready'}
        <div class="actions">
          {#if onHere}
            <Button loading={busy === 'test'} disabled={demo} onclick={test}>Send a test</Button>
            <Button variant="ghost" loading={busy === 'off'} onclick={turnOff}
              >Turn off on this device</Button
            >
          {:else}
            <Button variant="primary" loading={busy === 'on'} disabled={demo} onclick={turnOn}
              >{#snippet icon()}<IconBell />{/snippet}Turn on for this device</Button
            >
          {/if}
        </div>
      {:else if support === 'denied'}
        <p class="subtle warn"><IconWarn /> Your browser decides this, not Phaseplay.</p>
      {/if}
    </section>
  {/if}

  <h2 class="section-title" id="topics-h">What you hear about</h2>
  <ul class="list card topics" aria-labelledby="topics-h">
    {#each NOTIFY_TOPICS as topic (topic)}
      {@const info = NOTIFY_TOPIC_INFO[topic]}
      <li>
        <label class="switch-row">
          <span class="grow">
            <strong>{info.label}</strong>
            <small class="muted" id="hint-{topic}">{info.hint}</small>
          </span>
          <input
            type="checkbox"
            role="switch"
            class="switch"
            checked={prefs[topic]}
            disabled={demo || saving === topic}
            aria-describedby="hint-{topic}"
            onchange={(e) => toggle(topic, e.currentTarget.checked)}
          />
        </label>
      </li>
    {/each}
  </ul>
  <p class="subtle small">These apply to all your devices and teams.</p>

  <h2 class="section-title">Your devices</h2>
  {#if devices === null}
    <Loader label="Loading devices" />
  {:else if !devices.length}
    <p class="subtle">No devices yet.</p>
  {:else}
    <ul class="list card devices" aria-label="Devices with notifications on">
      {#each devices as d (d.id)}
        <li>
          <span class="ic sm"><IconSmartphone /></span>
          <span class="grow">
            <strong>{d.label ?? 'A device'}{d.id === thisId ? ' (this device)' : ''}</strong>
            <small class="muted"
              >Added {ago(d.createdAt)}{d.lastOkAt
                ? ` · last notified ${ago(d.lastOkAt)}`
                : ''}</small
            >
          </span>
        </li>
      {/each}
    </ul>
    <p class="subtle small">
      To stop notifications on another device, open this page there. Signing out everywhere turns
      them all off.
    </p>
  {/if}
</div>

<style>
  .narrow {
    max-width: 680px;
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
  .lead {
    margin-top: var(--s-2);
    max-width: 60ch;
  }
  .note {
    display: flex;
    gap: var(--s-2);
    align-items: center;
    padding: var(--s-3) var(--s-4);
    margin-bottom: var(--s-4);
  }
  .note :global(svg) {
    width: 18px;
    height: 18px;
    flex: none;
  }
  .pad {
    display: grid;
    gap: var(--s-3);
    justify-items: start;
    padding: var(--s-5);
    margin-bottom: var(--s-4);
  }
  .h {
    font-size: var(--t-16);
  }
  .opt {
    display: flex;
    gap: var(--s-3);
    align-items: flex-start;
  }
  .opt p {
    font-size: var(--t-14);
    margin-top: 2px;
  }
  .ic {
    display: grid;
    place-items: center;
    flex: none;
    width: 40px;
    height: 40px;
    border-radius: var(--r-md);
    background: var(--accent-soft);
    color: var(--accent-text);
  }
  .ic.sm {
    width: 32px;
    height: 32px;
  }
  .ic :global(svg) {
    width: 18px;
    height: 18px;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-2);
  }
  .warn {
    display: flex;
    gap: 6px;
    align-items: center;
    font-size: var(--t-12);
  }
  .warn :global(svg) {
    width: 14px;
    height: 14px;
  }
  .topics,
  .devices {
    overflow: hidden;
  }
  .topics li,
  .devices li {
    border-bottom: 1px solid var(--border);
  }
  .topics li:last-child,
  .devices li:last-child {
    border-bottom: 0;
  }
  .switch-row,
  .devices li {
    display: flex;
    align-items: center;
    gap: var(--s-3);
    min-height: 64px;
    padding: var(--s-2) var(--s-4);
  }
  .switch-row {
    cursor: pointer;
  }
  .switch-row small,
  .devices small {
    display: block;
    font-size: var(--t-12);
  }
  .switch {
    appearance: none;
    flex: none;
    position: relative;
    width: 48px;
    height: 28px;
    margin: 8px 0;
    border-radius: 999px;
    background: var(--border-strong);
    cursor: pointer;
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
    background: var(--accent);
  }
  .switch:checked::after {
    transform: translateX(20px);
  }
  .switch:focus-visible {
    outline: 2px solid var(--focus, var(--accent));
    outline-offset: 2px;
  }
  .switch:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
  @media (prefers-reduced-motion: reduce) {
    .switch,
    .switch::after {
      transition: none;
    }
  }
  .small {
    font-size: var(--t-12);
    margin-top: var(--s-2);
  }
</style>
