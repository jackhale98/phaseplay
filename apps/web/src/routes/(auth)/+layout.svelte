<script lang="ts">
  import Logo from '#lib/marketing/Logo.svelte';
  let { children } = $props();
</script>

<div class="auth">
  <header><a href="/" class="brand"><Logo size={28} /> Phaseplay</a></header>
  <main>{@render children()}</main>
</div>

<style>
  .auth {
    min-height: 100dvh;
    display: flex;
    flex-direction: column;
    background:
      radial-gradient(900px 500px at 100% 0%, color-mix(in srgb, var(--accent) 12%, transparent), transparent 60%),
      var(--bg);
  }
  header {
    padding: calc(var(--safe-t) + var(--s-4)) var(--s-4) 0;
    max-width: 520px;
    width: 100%;
    margin: 0 auto;
  }
  .brand {
    display: inline-flex;
    align-items: center;
    gap: var(--s-2);
    font-weight: 800;
    color: var(--text);
    text-decoration: none;
  }
  main {
    flex: 1;
    width: 100%;
    max-width: 520px;
    margin: 0 auto;
    padding: var(--s-8) var(--s-4) calc(var(--safe-b) + var(--s-10));
  }
  main :global(h1) {
    font-size: clamp(1.8rem, 6vw, 2.25rem);
    letter-spacing: -0.03em;
  }
  main :global(.lede) {
    color: var(--text-2);
    margin: var(--s-3) 0 var(--s-8);
    font-size: 1.0625rem;
  }
  main :global(.alt) {
    margin-top: var(--s-6);
    font-size: var(--t-14);
    color: var(--text-2);
    display: grid;
    gap: var(--s-2);
  }
</style>
