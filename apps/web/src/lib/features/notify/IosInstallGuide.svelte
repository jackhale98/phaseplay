<!--
  iOS only delivers Web Push to web apps added to the Home Screen (iOS 16.4 and later), so on an
  iPhone or iPad in Safari we explain how to install first.
-->
<script lang="ts">
  import IconShareIos from '@lucide/svelte/icons/share';
  import IconSquarePlus from '@lucide/svelte/icons/square-plus';
  import { IconBell } from '#lib/icons';
</script>

<section class="card guide" aria-labelledby="ios-h">
  <h2 id="ios-h" class="h">Add Phaseplay to your Home Screen first</h2>
  <p class="muted">
    On iPhone and iPad, notifications only work for apps on the Home Screen (iOS 16.4 or later). It
    takes a few seconds:
  </p>
  <ol>
    <li>
      <span class="ic"><IconShareIos /></span>
      <span>Tap <strong>Share</strong> in Safari's toolbar.</span>
    </li>
    <li>
      <span class="ic"><IconSquarePlus /></span>
      <span>Choose <strong>Add to Home Screen</strong>, then <strong>Add</strong>.</span>
    </li>
    <li>
      <span class="ic"><IconBell /></span>
      <span
        >Open Phaseplay from your Home Screen and come back to <strong>More › Notifications</strong
        >.</span
      >
    </li>
  </ol>
</section>

<style>
  .guide {
    display: grid;
    gap: var(--s-3);
    padding: var(--s-5);
    margin-bottom: var(--s-4);
  }
  .h {
    font-size: var(--t-16);
  }
  ol {
    display: grid;
    gap: var(--s-3);
    margin: 0;
    padding: 0;
    list-style: none;
  }
  li {
    display: flex;
    align-items: center;
    gap: var(--s-3);
  }
  .ic {
    display: grid;
    place-items: center;
    flex: none;
    width: 36px;
    height: 36px;
    border-radius: var(--r-md);
    background: var(--accent-soft);
    color: var(--accent-text);
  }
  .ic :global(svg) {
    width: 18px;
    height: 18px;
  }
</style>
