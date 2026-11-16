<script lang="ts">
  import { page } from '$app/state';
  import Recorder from '#lib/features/match/Recorder.svelte';
</script>

{#key page.params.id}
  <Recorder eventId={page.params.id!} />
{/key}
