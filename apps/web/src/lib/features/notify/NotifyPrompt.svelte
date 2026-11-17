<!--
  A gentle, one-time nudge on Home once you've replied to something: notifications are where
  changes and reminders reach you. Hidden for good after "Not now" or a visit to the settings page.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { app } from '#lib/data/app.svelte';
  import Button from '#lib/components/Button.svelte';
  import { IconBell, IconX } from '#lib/icons';
  import { dismissPrompt, isIos, promptDismissed, pushSupport } from './push';

  let eligible = $state(false);
  let gone = $state(false);
  onMount(() => {
    const support = pushSupport();
    eligible =
      !promptDismissed() &&
      (support === 'ios-install' || (support === 'ready' && Notification.permission === 'default'));
  });
  const replied = $derived.by(() => {
    const s = app.snap;
    const me = s?.me.id;
    return !!me && Object.values(s.rows.rsvps).some((r) => r.memberId === me && r.status);
  });
  const show = $derived(eligible && !gone && replied && !app.demo);
  function later() {
    dismissPrompt();
    gone = true;
  }
</script>

{#if show}
  <aside class="card prompt" aria-labelledby="notify-prompt-h">
    <span class="ic"><IconBell /></span>
    <div class="grow">
      <h2 id="notify-prompt-h" class="h">Hear about changes straight away</h2>
      <p class="muted">
        Get a notification when a session moves, the team sheet is out, or you haven't replied.
        {#if isIos()}On iPhone, add Phaseplay to your Home Screen first.{/if}
      </p>
      <div class="actions">
        <Button variant="primary" size="sm" href="/settings/notifications">Turn on</Button>
        <Button variant="ghost" size="sm" onclick={later}>Not now</Button>
      </div>
    </div>
    <button class="x" type="button" aria-label="Dismiss" onclick={later}><IconX /></button>
  </aside>
{/if}

<style>
  .prompt {
    position: relative;
    display: flex;
    gap: var(--s-3);
    align-items: flex-start;
    padding: var(--s-4);
    margin-top: var(--s-4);
  }
  .h {
    font-size: var(--t-16);
    padding-right: 36px;
  }
  .prompt p {
    font-size: var(--t-14);
    margin-top: 2px;
  }
  .actions {
    display: flex;
    gap: var(--s-2);
    margin-top: var(--s-3);
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
  .ic :global(svg) {
    width: 20px;
    height: 20px;
  }
  .x {
    position: absolute;
    top: 4px;
    right: 4px;
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    border: 0;
    border-radius: var(--r-md);
    background: none;
    color: var(--text-2);
    cursor: pointer;
  }
  .x :global(svg) {
    width: 18px;
    height: 18px;
  }
</style>
