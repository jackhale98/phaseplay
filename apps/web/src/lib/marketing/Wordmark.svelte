<!-- PHASEPLAY in Archivo expanded 800, caps (docs/design.md §Brand). -->
<script lang="ts">
  let { size = '1rem' }: { size?: string } = $props();
</script>

<span class="wordmark" style:font-size={size}>Phaseplay</span>

<style>
  .wordmark {
    font-family: 'PP Wordmark', 'PP Sans', system-ui, sans-serif;
    font-weight: 800;
    font-stretch: 125%;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    line-height: 1;
    color: var(--text);
  }
</style>
