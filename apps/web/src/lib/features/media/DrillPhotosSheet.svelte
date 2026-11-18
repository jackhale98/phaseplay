<!-- Add, order, caption and remove a drill's photos (setup photos, scanned diagrams). -->
<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import { MEDIA_PER_DRILL, type DrillMeta } from '@phaseplay/shared';
  import { ApiError } from '#lib/api';
  import { app } from '#lib/data/app.svelte';
  import { toasts } from '#lib/stores/toast.svelte';
  import Sheet from '#lib/components/Sheet.svelte';
  import Button from '#lib/components/Button.svelte';
  import { IconOffline } from '#lib/icons';
  import PagesEditor from './PagesEditor.svelte';
  import { Drafts } from './drafts.svelte';
  import { applyList } from './upload';

  type Props = { open: boolean; drill: DrillMeta };
  let { open = $bindable(false), drill }: Props = $props();
  let drafts = $state(new Drafts(MEDIA_PER_DRILL));
  let error = $state<string | null>(null);
  let saving = $state(false);

  $effect(() => {
    if (!open) return;
    untrack(() => {
      drafts.dispose();
      drafts = new Drafts(MEDIA_PER_DRILL, drill.media ?? []);
      drafts.snapshot();
      error = null;
    });
  });
  onDestroy(() => drafts.dispose());

  async function save(e: SubmitEvent) {
    e.preventDefault();
    if (saving) return;
    error = null;
    if (drafts.busy) {
      error = 'Hang on, photos are still being prepared.';
      return;
    }
    if (!navigator.onLine) {
      error = "You're offline. Uploading photos needs a connection.";
      return;
    }
    if (app.demo) {
      error = "This is the demo team, so uploads aren't saved.";
      return;
    }
    saving = true;
    try {
      const list = await drafts.save('drill', drill.id);
      if (list) await applyList('drill', drill.id, list);
      if (list) toasts.success('Photos saved');
      open = false;
    } catch (err) {
      if ((err as Error).name === 'AbortError') error = 'Upload cancelled.';
      else if (err instanceof ApiError) error = err.message;
      else error = (err as Error).message || 'Something went wrong. Try again.';
    } finally {
      saving = false;
    }
  }
</script>

<Sheet
  bind:open
  title="Drill photos"
  description="A photo of the setup or a scanned diagram, shown with the drill. Up to {MEDIA_PER_DRILL}."
  size="md"
  onclose={() => drafts.cancelAll()}
>
  <form class="stack" onsubmit={save} novalidate>
    {#if !app.online}
      <p class="offline" role="status">
        <IconOffline /> You're offline. Uploading photos needs a connection.
      </p>
    {/if}
    <PagesEditor {drafts} noun="photo" locked={saving} />
    {#if error}<p class="err" role="alert">{error}</p>{/if}
    <div class="actions">
      <Button onclick={() => (saving ? drafts.cancelAll() : (open = false))}
        >{saving ? 'Cancel upload' : 'Cancel'}</Button
      >
      <Button type="submit" variant="primary" loading={saving} disabled={!app.online || drafts.busy}
        >Save photos</Button
      >
    </div>
  </form>
</Sheet>

<style>
  .offline {
    display: flex;
    gap: var(--s-2);
    align-items: center;
    margin: 0;
    padding: var(--s-3);
    border-radius: var(--r-md);
    background: var(--warn-soft);
    font-size: var(--t-14);
  }
  .offline :global(svg) {
    flex: none;
    width: 18px;
    height: 18px;
  }
  .err {
    margin: 0;
    padding: var(--s-3);
    border-radius: var(--r-md);
    background: var(--danger-soft);
    font-size: var(--t-14);
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--s-2);
  }
</style>
