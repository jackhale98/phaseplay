<!-- Shown while exploring the public demo team: explains that nothing is saved and offers the way out. -->
<script lang="ts">
  import { goto } from '$app/navigation';
  import { signOut } from '#lib/auth';
  import { IconSparkles } from '#lib/icons';

  let busy = $state(false);
  async function leave(to: string) {
    busy = true;
    await signOut();
    await goto(to);
  }
</script>

<aside class="demo" aria-label="Demo">
  <IconSparkles />
  <p>
    <strong>You're exploring the demo team.</strong>
    <span>Tap around freely: changes stay on this device and aren't saved.</span>
  </p>
  <div class="acts">
    <button class="go" type="button" disabled={busy} onclick={() => leave('/signup')}>Create your team</button>
    <button class="quit" type="button" disabled={busy} onclick={() => leave('/')}>Leave</button>
  </div>
</aside>

<style>
  .demo {
    display: flex;
    align-items: center;
    gap: var(--s-3);
    padding: var(--s-2) var(--s-4);
    background: var(--n-900);
    color: #eef4ef;
    font-size: var(--t-14);
  }
  :global(:root[data-theme='dark']) .demo {
    background: #1f2b23;
  }
  .demo > :global(svg) {
    width: 18px;
    height: 18px;
    flex: none;
    color: #f2c230;
  }
  p {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 0 var(--s-2);
  }
  span {
    color: #b9cbbf;
  }
  .acts {
    display: flex;
    gap: var(--s-2);
    flex: none;
  }
  button {
    min-height: 36px;
    padding: 0 var(--s-3);
    border-radius: var(--r-md);
    font-weight: 700;
    font-size: var(--t-14);
  }
  .go {
    border: 0;
    background: #f2c230;
    color: #1a1400;
  }
  .quit {
    border: 1px solid rgb(255 255 255 / 0.3);
    background: transparent;
    color: #eef4ef;
  }
  @media (max-width: 560px) {
    span {
      display: none;
    }
    .quit {
      display: none;
    }
  }
</style>
