<script lang="ts">
  import { page } from '$app/state';
  import DayView from '#lib/features/match/DayView.svelte';
</script>

{#key page.params.id}
  <DayView eventId={page.params.id!} />
{/key}
