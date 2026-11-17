<!-- Non-blocking choice after a sync conflict (docs/diagrams.md §Editing model). -->
<script lang="ts">
  type Props = { onmine: () => void; ontheirs: () => void; oncopy: () => void };
  let { onmine, ontheirs, oncopy }: Props = $props();
</script>

<div class="conflict" role="status" aria-live="polite">
  <p><strong>Someone else saved changes too.</strong> Pick which version to keep.</p>
  <div class="acts">
    <button onclick={onmine}>Keep mine</button>
    <button onclick={ontheirs}>Take theirs</button>
    <button onclick={oncopy}>Save as copy</button>
  </div>
</div>

<style>
  .conflict {
    position: fixed;
    left: 50%;
    bottom: calc(150px + var(--safe-b));
    transform: translateX(-50%);
    z-index: 30;
    width: min(560px, calc(100vw - 24px));
    padding: var(--s-3) var(--s-4);
    border-radius: var(--r-lg);
    background: var(--n-900, #151a17);
    color: #fff;
    box-shadow: var(--e-3);
  }
  p {
    margin: 0 0 var(--s-2);
    font-size: var(--t-14);
  }
  .acts {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-2);
  }
  button {
    min-height: 44px;
    padding: 0 var(--s-4);
    border-radius: var(--r-full);
    border: 1px solid rgb(255 255 255 / 0.35);
    background: transparent;
    color: #fff;
    font-weight: 650;
  }
  button:first-child {
    background: #fff;
    color: #151a17;
    border-color: #fff;
  }
</style>
