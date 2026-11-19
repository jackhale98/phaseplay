<script lang="ts">
  import Logo from '#lib/marketing/Logo.svelte';
  import Wordmark from '#lib/marketing/Wordmark.svelte';
</script>

<svelte:head>
  <title>Privacy · Phaseplay</title>
  <meta name="description" content="What Phaseplay stores, why, and how to export or delete it." />
</svelte:head>

<main class="doc">
  <a class="brand" href="/" aria-label="Phaseplay home"><Logo size={34} /> <Wordmark /></a>
  <h1>Privacy, in plain language</h1>
  <p class="lede">
    Phaseplay exists to run a rugby team. We keep the minimum needed to do that, and nothing else.
  </p>

  <h2>What we store</h2>
  <ul>
    <li>
      <strong>Your display name</strong>, and the passkeys you use to sign in (public keys only;
      your device keeps the private key).
    </li>
    <li>
      <strong>Team information</strong> your coaches enter: the schedule, team sheets, plays, drills,
      practice plans and match logs, including pictures coaches upload for plays and drills. Your device
      shrinks and re-saves each picture before it's sent, which removes its location and camera details.
    </li>
    <li>
      <strong>Your replies</strong>: RSVPs and attendance. An optional note on an RSVP is visible
      only to coaches and managers, and is deleted automatically 30 days after the event.
    </li>
    <li>
      <strong>Which plays you've opened</strong> (one record per day), so coaches know the squad has seen
      them.
    </li>
  </ul>

  <h2>What we never collect</h2>
  <ul>
    <li>No email address or phone number.</li>
    <li>
      No injury, medical or concussion information. Stoppages in match mode are never linked to a
      player.
    </li>
    <li>
      No analytics, advertising, trackers or third-party scripts. Fonts and icons are served from
      our own domain.
    </li>
  </ul>

  <h2>Your controls</h2>
  <ul>
    <li><strong>Export</strong> everything about you as a file from Settings → Account.</li>
    <li>
      <strong>Delete your account</strong> from the same place. Your name is removed from the team and
      your passkeys and sessions are erased.
    </li>
    <li>
      <strong>Leave a team</strong> at any time; coaches can remove members, which takes effect immediately.
    </li>
  </ul>

  <h2>Where it lives</h2>
  <p>
    Data is stored with Cloudflare (Workers and D1) and backed up with point-in-time recovery.
    Images you export are made on your device and never uploaded.
  </p>
  <p class="muted">Questions? Ask your coach to get in touch with the Phaseplay team.</p>
</main>

<style>
  .doc {
    max-width: 680px;
    margin: 0 auto;
    padding: calc(var(--safe-t) + var(--s-6)) var(--s-4) var(--s-16);
  }
  .brand {
    display: inline-flex;
    align-items: center;
    gap: var(--s-2);
    font-weight: 800;
    color: var(--text);
    text-decoration: none;
    margin-bottom: var(--s-10);
  }
  .brand :global(svg) {
    flex: none;
  }
  h1 {
    font-size: clamp(2rem, 6vw, 2.75rem);
    letter-spacing: -0.03em;
  }
  .lede {
    font-size: 1.125rem;
    color: var(--text-2);
    margin: var(--s-4) 0 var(--s-8);
  }
  h2 {
    font-size: var(--t-20);
    margin: var(--s-8) 0 var(--s-3);
  }
  ul {
    padding-left: 1.2em;
    display: grid;
    gap: var(--s-2);
    color: var(--text-2);
  }
  p {
    color: var(--text-2);
    margin-bottom: var(--s-3);
  }
  strong {
    color: var(--text);
  }
</style>
