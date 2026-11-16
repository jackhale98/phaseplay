<script lang="ts">
  import { page } from '$app/state';
  import Summary from '#lib/features/match/Summary.svelte';
</script>

{#key page.params.id}
  <Summary eventId={page.params.id!} />
{/key}
