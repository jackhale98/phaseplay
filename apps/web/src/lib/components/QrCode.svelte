<script lang="ts">
  import { encode } from 'uqr';
  let { text, size = 220, label }: { text: string; size?: number; label: string } = $props();
  const qr = $derived(encode(text, { ecc: 'M', border: 2 }));
  const path = $derived.by(() => {
    let d = '';
    qr.data.forEach((row, y) => row.forEach((on, x) => on && (d += `M${x} ${y}h1v1h-1z`)));
    return d;
  });
</script>

<svg
  width={size}
  height={size}
  viewBox="0 0 {qr.size} {qr.size}"
  role="img"
  aria-label={label}
  shape-rendering="crispEdges"
>
  <rect width={qr.size} height={qr.size} fill="#fff" />
  <path d={path} fill="#0b0f0c" />
</svg>

<style>
  svg {
    border-radius: var(--r-md);
  }
</style>
