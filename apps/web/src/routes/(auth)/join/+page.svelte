<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import type { InvitePreview } from '@phaseplay/shared';
  import { api, ApiError, v1 } from '#lib/api';
  import { app } from '#lib/data/app.svelte';
  import { fragmentToken, friendlyWebAuthnError, signOut, signUp } from '#lib/auth';
  import Button from '#lib/components/Button.svelte';
  import Field from '#lib/components/Field.svelte';
  import Crest from '#lib/components/Crest.svelte';
  import RecoveryCodes from '#lib/components/RecoveryCodes.svelte';
  import { IconKey } from '#lib/icons';

  let token = $state<string | null>(null);
  let preview = $state<InvitePreview | null>(null);
  let problem = $state<string | null>(null);
  let signedIn = $state(false);
  let name = $state('');
  let claim = $state<string | null>(null);
  let busy = $state(false);
  let error = $state<string | null>(null);
  let codes = $state<string[] | null>(null);
  let joinedTeam = $state<string | null>(null);

  onMount(async () => {
    token = fragmentToken();
    if (!token)
      return (problem = 'This invite link looks incomplete. Ask your coach to send it again.');
    try {
      preview = await api<InvitePreview>(v1('/invites/preview'), {
        method: 'POST',
        body: { token },
      });
      if (preview.kind === 'relink')
        return void goto(`/relink${location.hash}`, { replaceState: true });
    } catch (e) {
      problem = e instanceof ApiError ? e.message : 'Could not open this invite.';
      return;
    }
    signedIn = await app.init();
    // The read-only demo account can't join teams: start fresh as yourself.
    if (app.demo) {
      await signOut();
      signedIn = false;
    }
  });

  async function accept() {
    const r = await api<{ teamId: string }>(v1('/invites/accept'), {
      method: 'POST',
      body: { token, claimMemberId: claim },
    });
    await app.refreshMe();
    await app.selectTeam(r.teamId);
    return r.teamId;
  }

  async function join(e?: SubmitEvent) {
    e?.preventDefault();
    busy = true;
    error = null;
    try {
      if (!signedIn) {
        if (!name.trim()) {
          error = 'Tell your team what to call you';
          return;
        }
        codes = await signUp(name.trim());
      }
      joinedTeam = await accept();
      if (!codes) await goto('/home', { replaceState: true });
    } catch (err) {
      error = err instanceof ApiError ? err.message : friendlyWebAuthnError(err);
    } finally {
      busy = false;
    }
  }
</script>

<svelte:head><title>Join {preview?.team.name ?? 'your team'} · Phaseplay</title></svelte:head>

{#if problem}
  <h1>Invite unavailable</h1>
  <p class="lede">{problem}</p>
  <Button href="/">Go to Phaseplay</Button>
{:else if !preview}
  <div class="skeleton" aria-busy="true" aria-label="Loading invite"></div>
{:else if codes && joinedTeam}
  <h1>You're in! Save your recovery codes</h1>
  <p class="lede">If you lose your phone, one of these gets you back into {preview.team.name}.</p>
  <RecoveryCodes {codes} ondone={() => goto('/home', { replaceState: true })} />
{:else}
  <div class="team">
    <Crest colors={preview.team.colors} text={preview.team.shortName} size={72} />
    <div>
      <p class="eyebrow">You're invited</p>
      <h1>{preview.team.name}</h1>
      <p class="muted">
        {preview.invitedBy} invited you to join as a <strong>{preview.role}</strong>.
      </p>
    </div>
  </div>

  <form class="stack" onsubmit={join} novalidate>
    {#if !signedIn}
      <Field
        label="Your name"
        hint="As your teammates know you"
        error={error && !name.trim() ? error : null}
      >
        {#snippet children({ id, describedby })}
          <input
            {id}
            aria-describedby={describedby}
            bind:value={name}
            autocomplete="name"
            maxlength="40"
          />
        {/snippet}
      </Field>
    {/if}
    {#if preview.pending.length}
      <fieldset class="claim">
        <legend>Are you already on the squad list?</legend>
        <div class="names">
          {#each preview.pending as p (p.id)}
            <label class:on={claim === p.id}
              ><input
                type="radio"
                name="claim"
                value={p.id}
                bind:group={claim}
              />{p.displayName}</label
            >
          {/each}
          <label class:on={claim === null}
            ><input type="radio" name="claim" value={null} bind:group={claim} />None of these</label
          >
        </div>
      </fieldset>
    {/if}
    <Button type="submit" variant="primary" size="lg" block loading={busy}>
      {#snippet icon()}<IconKey />{/snippet}{signedIn
        ? `Join ${preview.team.shortName}`
        : 'Join with a passkey'}
    </Button>
    {#if error && (signedIn || name.trim())}<p class="err" role="alert">{error}</p>{/if}
  </form>
  {#if !signedIn}
    <div class="alt">
      <span
        >Already use Phaseplay? <a
          href="/signin?next={encodeURIComponent(
            '/join' + (typeof location !== 'undefined' ? location.hash : ''),
          )}">Sign in first</a
        ></span
      >
    </div>
  {/if}
{/if}

<style>
  .team {
    display: flex;
    gap: var(--s-5);
    align-items: center;
    margin-bottom: var(--s-8);
  }
  .team h1 {
    margin: 2px 0 var(--s-2);
  }
  .claim {
    border: 0;
    padding: 0;
    margin: 0;
  }
  legend {
    font-weight: 650;
    font-size: var(--t-14);
    margin-bottom: var(--s-2);
  }
  .names {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-2);
  }
  .names label {
    display: inline-flex;
    align-items: center;
    gap: var(--s-2);
    min-height: 44px;
    padding: 0 var(--s-4);
    border-radius: var(--r-full);
    border: 1px solid var(--border-strong);
    background: var(--surface);
    font-weight: 600;
    cursor: pointer;
  }
  .names label.on {
    border-color: var(--accent);
    background: var(--accent-soft);
  }
  .names input {
    accent-color: var(--accent);
  }
  .skeleton {
    height: 220px;
    border-radius: var(--r-lg);
    background: linear-gradient(90deg, var(--surface-2), var(--surface-3), var(--surface-2));
    background-size: 200% 100%;
    animation: sh 1.2s linear infinite;
  }
  @keyframes sh {
    to {
      background-position: -200% 0;
    }
  }
  .err {
    color: var(--danger);
    font-weight: 600;
  }
</style>
